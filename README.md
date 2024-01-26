# Smart Second Brain

<p align="center">

<picture>

<source media="(prefers-color-scheme: dark)" srcset="https://github.com/nicobrauchtgit/obsidian-Smart2Brain/assets/103033288/25639510-a75d-4500-b907-5b416af37353">

<source media="(prefers-color-scheme: light)" srcset="https://github.com/nicobrauchtgit/obsidian-Smart2Brain/assets/103033288/25639510-a75d-4500-b907-5b416af37353">

<img alt="Octopus" src="https://github.com/nicobrauchtgit/obsidian-Smart2Brain/assets/103033288/25639510-a75d-4500-b907-5b416af37353" height="600rem">

</picture>

</p>

# Featurs
TBD

# Setup
The Smart Second Brain provides two methods to connect to your notes. You can either use [Ollama](https://github.com/ollama/ollama) to run an LLM locally on your computer or create an [OpenAI](https://openai.com/) Key and make use of the GPT models.

## Ollama

> [!Warning]
> Ollama currently does not support persistent environment variables. So the `OLLAMA_ORIGINS="*"` var has to be set every time the service is launched.
> This includes a restart of the Mac Application.

### MacOS App

1. Go to the [Ollama](https://ollama.ai/download/) Website and follow the install instructions.
2. Go to your Terminal and execute the following Command:

```zsh
$ launchctl setenv OLLAMA_ORIGINS "*"
```

3. Quit the Ollama service (in your Menu Bar click on the Ollama Icon and click Quit)
4. Start the Ollama service again.

### MacOS CLI App
1. Install Ollama.
    - With [Homebrew](https://brew.sh/):
    
    ```zsh
    $ brew install ollama
    ```
    
    - With curl:
    
    ```zsh
    $ curl https://ollama.ai/install.sh | sh
    ```
    
    - [Manually](https://github.com/ollama/ollama/blob/main/docs/linux.md) with binaries.

2. Start the Ollama service with the Origins flag:

```zsh
$ OLLAMA_ORIGINS="*" ollama serve
```

### Linux

1. Install Ollama:

    - With curl: 
    ```zsh
    $ curl https://ollama.ai/install.sh | sh
    ```

   - [Manually](https://github.com/ollama/ollama/blob/main/docs/linux.md) with binaries.
     
2. Follow these [instructions](https://github.com/ollama/ollama/blob/main/docs/faq.md#setting-environment-variables-on-linux) to set `OLLAMA_ORIGINS="*"` as an environment variable. 

3. Restart the Ollama service.

### Windows

> [!Note]
> Coming soon! For now, you can install Ollama on Windows via WSL2.

## OpenAI

> [!Important]
> Currently, in order for the API-Key to work you have to upgrade to an OpenAI paid account. This means depositing at least $5 onto your OpenAI account. Maybe this changes in the future

1. Create an [OpenAI Account](https://platform.openai.com/login/).
2. Create an [API-Key](https://platform.openai.com/api-keys) by clicking on "Create new secret key" and following the instructions.
3. Copy the key and paste it into the Smart Second Brain settings.

# Inspirations

1. [Kanban Plugin for Obsidian](https://github.com/mgmeyers/obsidian-kanban)
2.
