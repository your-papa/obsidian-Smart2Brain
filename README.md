<div align="center">

<img alt="Octopus" src="https://github.com/nicobrauchtgit/obsidian-Smart2Brain/assets/48623649/03cadd13-b3e5-4eae-bbec-13eff9a78f22" height="500px">

</div>

# Your Smart Second Brain
> [!Note]
> Still in Open Beta. MVP will be released mid-March.

# Features

- **Chat with your Notes**
    - **RAG pipeline:** all your notes will be embedded into vectors and then retrieved based on the similarity (relevance) to your query in order to generate an answer based on the retrieved notes
    - **Get reference links to notes:** because the answers are generated based on your retrieved notes we can trace where the information comes from and reference the origin of the knowledge in the answers as Obsidian links
    - **Chat with LLM:** you can disable the function to answer queries based on your notes and then all the answers generated are based on the chosen LLM’s training knowledge
    - **Save chats:** you can save your chats and continue the conversation at a later time
    - **Different chat views:** you can choose between two chat views: ‘comfy’ (like a typical chat view) and the ‘compact’ view

- **Choose ANY preferred Large Language Model (LLM)**
    - **https://github.com/ollama/ollama to integrate LLMs:** Ollama is a tool to run LLMs locally, without the need of a cloud service. Its usage is similar to Docker, but it's specifically designed for LLMs. You can use it as an interactive shell, through its REST API or using it from a Python library.
    - **Quickly switch between LLMs:** Ollama allows to comfortably change in between different LLMs for different purposes, as for example changing from one for scientific writing to one for persuasive writing.
    - **Use ChatGPT:** Although, our focus lays on a private AI Assistant you can leverage OpenAI’s ChatGPT and it’s advanced capabilities which makes it a whole solution to switch between private LLMs and ChatGPT.

# Limitations

- **Performance depends on chosen LLM:** as LLMs are trained for different tasks, LLMs perform better or worse in embedding notes or generating answers. You can go with our recommendations or find your own best fit.
- **Performance depends on knowledge structure and organisation:** the performance improves when you have a clear structure and do not mix up to many unrelated information or connect unrelated notes. Therefore we recommend a well-structured vault and notes.
- **AI Assistant might generate incorrect or irrelevant answers:** due to lack of relevant notes or limitations of AI understanding the AI Assistant might generate unsatisfying answers. In those cases we recommend to rephrase your query or describe the context in more detail

# Setup
Follow the onboarding instructions provided on initial plugin startup.
