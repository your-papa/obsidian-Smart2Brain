import { App, Notice, TFile, normalizePath } from 'obsidian';
import { Papa, obsidianDocumentLoader, type GenModel, type EmbedModel } from 'papa-ts';
import { get } from 'svelte/store';
import { wildTest } from './components/Settings/FuzzyModal';
import Log, { LogLvl } from './logging';
import { data, papaState, errorState, papaIndexingProgress, chatHistory, serializeChatHistory, runState, runContent, papaIndexingTimeLeft } from './store';
import { _ } from 'svelte-i18n';
import { Ollama } from './Providers/Ollama';
import { OpenAI } from './Providers/OpenAI';

export default class SmartSecondBrain {
    private papa: Papa;
    private app: App;
    private needsToSaveVectorStoreData = false;
    private pluginDir: string;

    constructor(app: App, pluginDir: string) {
        this.app = app;
        this.pluginDir = pluginDir;
    }

    async init() {
        const { genModel, embedModel, debugginLangchainKey, isVerbose, excludeFF } = get(data);
        const t = get(_);

        if (!(await this.canInit())) return;

        if (get(papaState) !== 'indexing-pause') {
            papaState.set('loading');
            Log.info('Initializing second brain', '\nGen Model: ', genModel, '\nEmbed Model: ', embedModel);
            try {
                this.papa = new Papa();
                await this.papa.init({
                    genModel: this.getPapaGenModel(),
                    embedModel: this.getPapaEmbedModel(),
                    langsmithApiKey: debugginLangchainKey || undefined,
                    logLvl: isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED,
                });
            } catch (e) {
                Log.error(e);
                papaState.set('error');
                return new Notice(t('notice.failed', { values: { error: e } }), 4000);
            }
            // check if vector store data exists
            if (await this.app.vault.adapter.exists(this.getVectorStoreFile())) {
                const vectorStoreData = await this.app.vault.adapter.readBinary(this.getVectorStoreFile());
                await this.papa.load(vectorStoreData);
            }
        }
        const mdFiles = this.app.vault.getMarkdownFiles();
        const docs = await obsidianDocumentLoader(
            this.app,
            mdFiles.filter((mdFile: TFile) => {
                for (const exclude of excludeFF) if (wildTest(exclude, mdFile.path)) return false;
                return true;
            })
        );
        papaState.set('indexing');
        let needsSave = false;
        try {
            let lastTime = Date.now();
            const timePerDoc = [];

            let lastTotalDocs = 0;
            for await (const result of this.papa.embedDocuments(docs)) {
                needsSave = (!this.needsToSaveVectorStoreData && result.numAdded > 0) || result.numDeleted > 0;
                const progress = ((result.numAdded + result.numSkipped) / docs.length) * 100;
                papaIndexingProgress.set(Math.max(progress, get(papaIndexingProgress)));
                const currentTime = Date.now();
                timePerDoc.push(currentTime - lastTime);
                const numberOfDocumentsRemaining = docs.length * (1 - get(papaIndexingProgress) / 100);
                const averageTimePerDocumentInSeconds =
                    timePerDoc.reduce((a, b) => a + b, 0) / timePerDoc.length / (result.numAdded + result.numSkipped - lastTotalDocs) / 1000;
                lastTotalDocs = result.numAdded + result.numSkipped;
                if (timePerDoc.length > 5) {
                    timePerDoc.shift();
                    papaIndexingTimeLeft.set(Math.ceil(averageTimePerDocumentInSeconds * numberOfDocumentsRemaining));
                }
                lastTime = currentTime;
                if (get(papaState) === 'indexing-pause') break;
            }
        } catch (e) {
            Log.error(e);
            papaState.set('error');
            errorState.set('failed-indexing');
            new Notice(t('notice.failed_indexing'), 4000);
        }

        this.needsToSaveVectorStoreData = needsSave;
        this.saveVectorStoreData();
        if (get(papaIndexingProgress) === 100) {
            new Notice(t('notice.done'), 2000);
            papaIndexingProgress.set(0);
            papaState.set('idle');
        }
    }

    async cancelIndexing() {
        // if (this.app.vault.adapter.exists(this.getVectorStoreFile())) await this.app.vault.adapter.remove(this.getVectorStoreFile());
        papaState.set('uninitialized');
        papaIndexingProgress.set(0);
    }

    canRunPapa() {
        const t = get(_);
        if (get(papaState) === 'running') return new Notice(t('notice.still_running'), 4000) && false;
        else if (get(papaState) === 'indexing' || get(papaState) === 'indexing-pause' || get(papaState) === 'loading')
            return new Notice(t('notice.still_indexing'), 4000) && false;
        else if (get(papaState) === 'error') return new Notice(t('notice.error'), 4000) && false;
        else if (get(papaState) !== 'idle') return new Notice(t('notice.not_initialized'), 4000) && false;
        return true;
    }

    async runPapa() {
        papaState.set('running');
        try {
            const cH = get(chatHistory);
            const userQuery = cH[cH.length - 1].content;
            const responseStream = this.papa.run({
                isRAG: get(data).isUsingRag,
                userQuery,
                chatHistory: serializeChatHistory(cH.slice(0, cH.length - 1)),
                lang: get(data).assistantLanguage,
            });
            for await (const response of responseStream) {
                runState.set(response.status);
                runContent.set(response.content);
            }
        } catch (error) {
            const errorMsg = get(_)('notice.run_failed', { values: { error } });
            // Log.error(errorMsg);
            runContent.set(errorMsg);
            // papaState.set('error');
            // errorState.set('run-failed');
            new Notice(errorMsg, 4000);
        }
        papaState.set('idle');
    }

    async createFilenameForChat() {
        let fileName = await this.papa.createTitleFromChatHistory(get(data).assistantLanguage, serializeChatHistory(get(chatHistory)));
        // File name cannot contain any of the following characters: \, /, :, *, ?, ", <, >, |, #
        fileName = fileName.replace(/[\\/:*?"<>|#]/g, '');
        return fileName;
    }

    getVectorStoreFile() {
        const { embedModel } = get(data);
        return normalizePath(this.pluginDir + '/vectorstores/' + embedModel + '.bin');
    }

    async saveVectorStoreData() {
        if (this.needsToSaveVectorStoreData && this.papa) {
            Log.debug('Saving vector store data');
            this.needsToSaveVectorStoreData = false;
            // create vectorstores directory if it doesn't exist
            (await this.app.vault.adapter.exists(this.pluginDir + '/vectorstores')) || (await this.app.vault.adapter.mkdir(this.pluginDir + '/vectorstores'));
            await this.app.vault.adapter.writeBinary(this.getVectorStoreFile(), await this.papa.getData());
            Log.info('Saved vector store data');
        }
    }

    async onFileChange(file: TFile) {
        if (!this.papa) return;
        for (const exclude of get(data).excludeFF) if (wildTest(exclude, file.path)) return;
        const docs = await obsidianDocumentLoader(this.app, [file]);
        this.papa.embedDocuments(docs, 'byFile');
        this.needsToSaveVectorStoreData = true;
    }
    async onFileDelete(file: TFile) {
        if (!this.papa) return;
        for (const exclude of get(data).excludeFF) if (wildTest(exclude, file.path)) return;
        const docs = await obsidianDocumentLoader(this.app, [file]);
        this.papa.deleteDocuments({ docs });
        this.needsToSaveVectorStoreData = true;
    }
    async onFileRename(file: TFile, oldPath: string) {
        if (!this.papa) return;
        for (const exclude of get(data).excludeFF) if (wildTest(exclude, file.path)) return;
        await this.papa.deleteDocuments({ sources: [oldPath] });
        const docs = await obsidianDocumentLoader(this.app, [file]);
        this.papa.embedDocuments(docs, 'byFile');
        this.needsToSaveVectorStoreData = true;
    }

    setSimilarityThreshold() {
        if (this.papa) this.papa.setSimilarityThreshold(get(data).embedModels[get(data).embedModel].similarityThreshold);
    }

    stopRun() {
        if (this.papa) this.papa.stopRun();
        papaState.set('idle');
    }

    setNumOfDocsToRetrieve(k: number) {
        if (this.papa) this.papa.setNumOfDocsToRetrieve(k);
    }

    setGenModel() {
        if (this.papa) this.papa.setGenModel(this.getPapaGenModel());
    }

    setTracer(langchainKey: string) {
        if (this.papa) this.papa.setTracer(langchainKey);
    }

    private async canInit(): Promise<boolean> {
        const { genModel, embedModel, ollamaProvider, genProvider, embedProvider } = get(data);
        const t = get(_);
        const ollamaModels = ollamaProvider.getModels();

        if (get(papaState) === 'running') {
            new Notice(t('notice.still_running'), 4000);
            return false;
        } else if (get(papaState) === 'indexing' || get(papaState) === 'loading') {
            new Notice(t('notice.still_indexing'), 4000);
            return false;
        } else if (!(await genProvider.isSetup())) {
            papaState.set('error');
            return false;
        } else if (!(await embedProvider.isSetup())) {
            papaState.set('error');
            return false;
        } else if (genProvider.isLocal && !(await ollamaModels).includes(genModel)) {
            papaState.set('error');
            errorState.set('ollama-gen-model-not-installed');
            new Notice(t('notice.ollama_gen_model'), 4000);
            return false;
        } else if (embedProvider.isLocal && !(await ollamaModels).includes(embedModel)) {
            papaState.set('error');
            errorState.set('ollama-embed-model-not-installed');
            new Notice(t('notice.ollama_embed_model'), 4000);
            return false;
        } else return true;
    }

    private getPapaGenModel() {
        const { genModel, genModels, genProvider } = get(data);
        let papaGenModel: GenModel;
        if (genProvider instanceof Ollama) {
            papaGenModel = { model: genModel, ...genModels[genModel], baseUrl: genProvider.baseUrl };
        } else if (genProvider instanceof OpenAI) {
            papaGenModel = { model: genModel, ...genModels[genModel], openAIApiKey: genProvider.apiKey };
        }
        return papaGenModel;
    }

    private getPapaEmbedModel() {
        const { embedModel, embedModels, embedProvider } = get(data);
        let papaEmbedModel: EmbedModel;
        if (embedProvider instanceof Ollama) {
            papaEmbedModel = { model: embedModel, ...embedModels[embedModel], baseUrl: embedProvider.baseUrl };
        } else if (embedProvider instanceof OpenAI) {
            papaEmbedModel = { model: embedModel, ...embedModels[embedModel], openAIApiKey: embedProvider.apiKey };
        }
        return papaEmbedModel;
    }
}
