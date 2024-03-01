<div align="center">

<img alt="Octopus" src="https://github.com/nicobrauchtgit/obsidian-Smart2Brain/assets/48623649/03cadd13-b3e5-4eae-bbec-13eff9a78f22" height="500px">

</div>

# Smart Second Brain
> [!Note]
> Still in Open Beta. MVP will be released mid-March.

## Features
TBD

# Setup
The Smart Second Brain provides two modes. When the Incognito mode is enabled it uses [Ollama](https://github.com/ollama/ollama) to run an LLM locally on your computer. When it is disabled it uses [OpenAI](https://openai.com/)'s GPT-Models.

## Ollama

> [!Note]
> Ollama currently does not support a persistent config. So the `OLLAMA_ORIGINS="*"` environment variable has to be set every time the service is launched.
> This includes a restart of the Mac Application.

### MacOS App

1. Go to the [Ollama](https://ollama.ai/download/) Website and follow the install instructions.
2. Go to your Terminal and execute the following Command:

```zsh
launchctl setenv OLLAMA_ORIGINS "*"
```

3. Quit the Ollama service (in your Menu Bar click on the Ollama Icon and click Quit)
4. Start the Ollama service again.

### MacOS CLI App
1. Install Ollama.
    - with [Homebrew](https://brew.sh/):
    
    ```zsh
    brew install Ollama
    ```
    
    - with curl:
    
    ```zsh
    curl -fsSL https://ollama.ai/install.sh | sh
    ```
    
    - or [manually](https://github.com/ollama/ollama/blob/main/docs/linux.md) with binaries.

2. Start the Ollama service with the Origins flag:

```zsh
OLLAMA_ORIGINS="*" ollama serve
```

### Linux

1. Install Ollama:

    - with curl: 
    ```zsh
    curl -fsSL https://ollama.ai/install.sh | sh
    ```

   - or [manually](https://github.com/ollama/ollama/blob/main/docs/linux.md) with binaries.
     
2. Follow these [instructions](https://github.com/ollama/ollama/blob/main/docs/faq.md#setting-environment-variables-on-linux) to set `OLLAMA_ORIGINS="*"` as an environment variable. 

3. Restart the Ollama service.

### Windows

1. Install [Ollama](https://ollama.com/download)
2. Quit running Ollama instance
3. Start PowerShell and run the following command to set the origins
```powershell
$env:OLLAMA_ORIGINS="*"; ollama serve
```

## OpenAI

> [!Note]
> Currently, for the API-Key to work you have to upgrade to an OpenAI paid account. This means depositing at least $5 onto your OpenAI account. Maybe this changes in the future

1. Create an [OpenAI Account](https://platform.openai.com/login/).
2. Create an [API-Key](https://platform.openai.com/api-keys) by clicking on "Create new secret key" and following the instructions.
3. Copy the key and paste it into the Smart Second Brain settings.
