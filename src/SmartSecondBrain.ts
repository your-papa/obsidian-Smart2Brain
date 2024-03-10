import { App, Notice, TFile, normalizePath } from 'obsidian';
import { Papa, obsidianDocumentLoader } from 'papa-ts';
import { get } from 'svelte/store';
import { wildTest } from './components/Settings/FuzzyModal';
import { isOllamaRunning, getOllamaModels } from './controller/Ollama';
import { isAPIKeyValid } from './controller/OpenAI';
import Log, { LogLvl } from './logging';
import { data, papaState, errorState, papaIndexingProgress, chatHistory, serializeChatHistory, runState, runContent } from './store';

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
        const d = get(data);
        if (get(papaState) === 'running') return new Notice('Smart Second Brain is still running.', 4000);
        else if (get(papaState) === 'indexing' || get(papaState) === 'loading') {
            return new Notice('Please wait for the indexing to finish', 4000);
        } else if (d.isIncognitoMode && !(await isOllamaRunning())) {
            papaState.set('error');
            errorState.set('ollama-not-running');
            return new Notice('Please make sure Ollama is running before initializing Smart Second Brain.', 4000);
        } else if (d.isIncognitoMode) {
            const models = await getOllamaModels();
            if (!models.includes(d.ollamaGenModel.model)) {
                papaState.set('error');
                errorState.set('ollama-model-not-installed');
                return new Notice('Ollama model not installed. Please install the model before initializing Smart Second Brain.', 4000);
            }
        } else if (!d.isIncognitoMode && !(await isAPIKeyValid(d.openAIGenModel.openAIApiKey))) {
            papaState.set('error');
            return new Notice('Please make sure OpenAI API Key is valid before initializing Smart Second Brain.', 4000);
        }
        if (get(papaState) !== 'indexing-pause') {
            papaState.set('loading');
            Log.info(
                'Initializing second brain',
                '\nGen Model: ',
                d.isIncognitoMode ? d.ollamaGenModel : d.openAIGenModel,
                '\nEmbed Model: ',
                d.isIncognitoMode ? d.ollamaEmbedModel : d.openAIEmbedModel
            );
            try {
                this.papa = new Papa();
                await this.papa.init({
                    genModel: d.isIncognitoMode ? d.ollamaGenModel : d.openAIGenModel,
                    embedModel: d.isIncognitoMode ? d.ollamaEmbedModel : d.openAIEmbedModel,
                    langsmithApiKey: d.debugginLangchainKey || undefined,
                    logLvl: d.isVerbose ? LogLvl.DEBUG : LogLvl.DISABLED,
                });
            } catch (e) {
                Log.error(e);
                papaState.set('error');
                return new Notice('Failed to initialize Smart Second Brain (Error: ' + e + '). Please retry.', 4000);
            }
            // check if vector store data exists
            if (await this.app.vault.adapter.exists(this.getVectorStorePath())) {
                const vectorStoreData = await this.app.vault.adapter.readBinary(this.getVectorStorePath());
                await this.papa.load(vectorStoreData);
            }
        }
        const mdFiles = this.app.vault.getMarkdownFiles();
        const docs = await obsidianDocumentLoader(
            this.app,
            mdFiles.filter((mdFile: TFile) => {
                for (const exclude of d.excludeFF) if (wildTest(exclude, mdFile.path)) return false;
                return true;
            })
        );
        papaState.set('indexing');
        // const embedNotice = new Notice('Indexing notes into your smart second brain...', 0);
        let needsSave = false;
        try {
            for await (const result of this.papa.embedDocuments(docs)) {
                // embedNotice.setMessage(
                //     `Indexing notes into your smart second brain... Added: ${result.numAdded}, Skipped: ${result.numSkipped}, Deleted: ${result.numDeleted}`
                // );
                needsSave = (!this.needsToSaveVectorStoreData && result.numAdded > 0) || result.numDeleted > 0;
                const progress = ((result.numAdded + result.numSkipped) / docs.length) * 100;
                papaIndexingProgress.set(Math.max(progress, get(papaIndexingProgress)));
                // pause indexing on "indexing-stopped" state
                if (get(papaState) === 'indexing-pause') break;
            }
            // embedNotice.hide();
        } catch (e) {
            Log.error(e);
            papaState.set('error');
            // TODO add error state
            new Notice('Failed to index notes into your smart second brain. Please retry.', 4000);
        }
        this.needsToSaveVectorStoreData = needsSave;
        this.saveVectorStoreData();
        if (get(papaIndexingProgress) === 100) {
            new Notice('Smart Second Brain initialized.', 2000);
            papaIndexingProgress.set(0);
            papaState.set('idle');
        }
    }

    canRunPapa() {
        if (get(papaState) === 'running') return new Notice('Please wait for the current query to finish', 4000) && false;
        else if (get(papaState) === 'indexing' || get(papaState) === 'indexing-pause' || get(papaState) === 'loading')
            return new Notice('Please wait for the indexing to finish', 4000) && false;
        else if (get(papaState) === 'error') return new Notice('Please wait for the error to resolve', 4000) && false;
        else if (get(papaState) !== 'idle') return new Notice('Please initialize your Smart Second Brain first', 4000) && false;
        return true;
    }

    async runPapa() {
        papaState.set('running');
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
            if (get(runState) === 'stopped') {
                papaState.set('idle');
                return; // when used break it somehow returns the whole function
            }
        }
        papaState.set('idle');
    }

    async createFilenameForChat() {
        let fileName = await this.papa.createTitleFromChatHistory(get(data).assistantLanguage, serializeChatHistory(get(chatHistory)));
        // File name cannot contain any of the following characters: \, /, :, *, ?, ", <, >, |, #
        fileName = fileName.replace(/[\\/:*?"<>|#]/g, '');
        return fileName;
    }

    private getVectorStorePath() {
        const d = get(data);
        return normalizePath(this.pluginDir + '/' + (d.isIncognitoMode ? d.ollamaEmbedModel.model : d.openAIEmbedModel.model) + '-vector-store.bin');
    }

    async saveVectorStoreData() {
        if (this.needsToSaveVectorStoreData && this.papa) {
            Log.debug('Saving vector store data');
            this.needsToSaveVectorStoreData = false;
            await this.app.vault.adapter.writeBinary(this.getVectorStorePath(), await this.papa.getData());
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

    setSimilarityThreshold(value: number) {
        if (this.papa) this.papa.setSimilarityThreshold(value);
    }

    setTracer(langchainKey: string) {
        if (this.papa) this.papa.setTracer(langchainKey);
    }
}
