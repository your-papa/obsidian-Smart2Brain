#Smart Second Brain

<p align="center">

<picture>

<source media="(prefers-color-scheme: dark)" srcset="https://github.com/nicobrauchtgit/obsidian-Smart2Brain/assets/103033288/25639510-a75d-4500-b907-5b416af37353">

">

<source media="(prefers-color-scheme: light)" srcset="https://github.com/nicobrauchtgit/obsidian-Smart2Brain/assets/103033288/25639510-a75d-4500-b907-5b416af37353">

<img alt="Octopus" src="https://github.com/nicobrauchtgit/obsidian-Smart2Brain/assets/103033288/25639510-a75d-4500-b907-5b416af37353" height="600rem">

</picture>

</p>
# Featurs
TBD
# Setup
The Smart Second Brain provides two methods to connect to your notes. You can either use [Ollama](https://github.com/ollama/ollama) to run an LLM locally on your computer or create an [OpenAI](https://openai.com/) Key and make use of the GPT models.
## Setup with Ollama

> [!Warning] Ollama Origins env var
> Ollama currently does not support persistent environment variables. So the `OLLAMA_ORIGINS="*"` var has to be set every time the service is launched.
> This includes a restart of the Mac Application.

## MacOS App

1. Go to the [Ollama](https://ollama.ai/download/) Website and follow the install instructions.
2. After the App is installed, start the App on your machine.
3. Go to your Terminal and execute the following Command:

```zsh
launchctl setenv OLLAMA_ORIGINS "*"
```

4. Quit the Ollama service (in your Menu Bar click on the Ollama Icon and click Quit)
5. Start the Ollama service again.

## MacOS Terminal App

1. Install Ollama via either [Homebrew](https://brew.sh/):

```zsh
brew install ollama
```

Curl:

```zsh
curl https://ollama.ai/install.sh | sh
```

or [manually](https://github.com/ollama/ollama/blob/main/docs/linux.md). 2. Start the Ollama service with the Origins flag:

```zsh
OLLAMA_ORIGINS="*" ollama serve
```

## Linux

1. Install Ollama via Curl:

```zsh
curl https://ollama.ai/install.sh | sh
```

or [manually](https://github.com/ollama/ollama/blob/main/docs/linux.md). 2. Follow the [instructions](https://github.com/ollama/ollama/blob/main/docs/faq.md#setting-environment-variables-on-linux) to set

```zsh
OLLAMA_ORIGINS="*"
```

as an environment variable. 3. Restart the Ollama service.

## Windows

> [!Note] Ollama currently doesn't support a Windows application!
> Coming soon! For now, you can install Ollama on Windows via WSL2.

## Setup with OpenAI

> [!Warning] Function of Api-Key
> Currently, in order for the Api-Key to work you have to upgrade to an OpenAI paid account. This means depositing at least $5 onto your OpenAI account. Maybe this changes in the future

0. If you do not have an OpenAI account, [create one](https://platform.openai.com/login/).
1. Create an Api-Key by following this [link](https://platform.openai.com/api-keys), clicking on "Create new secret key" and following the instructions.
2. Copy the key and paste it into the Smart Second Brain settings.

# Inspirations

1. [Kanban Plugin for Obsidian](https://github.com/mgmeyers/obsidian-kanban)
2.
