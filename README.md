<div align="center">

![2-05](https://github.com/your-papa/obsidian-Smart2Brain/assets/48623649/0f9671ab-c39a-46f1-b3e8-bc045b578965)

</div>

# Your Smart Second Brain

Your Smart Second Brain is a **free** and **open-source** Obsidian plugin to improve your overall knowledge management.
It serves as your **personal assistant**, powered by large language models like ChatGPT or Llama2.
It can directly access and process your notes, eliminating the need for manual prompt editing and it can operate **completely offline**, ensuring your data remains private and secure.

# 🌟 Features

**📝 Chat with your Notes**

- **RAG pipeline:** All your notes will be embedded into vectors and then retrieved based on the similarity to your query in order to generate an answer based on the retrieved notes
- **Get reference links to notes:** Because the answers are generated based on your retrieved notes we can trace where the information comes from and reference the origin of the knowledge in the answers as Obsidian links
- **Chat with LLM:** You can disable the function to answer queries based on your notes and then all the answers generated are based on the chosen LLM’s training knowledge
- **Save chats:** You can save your chats and continue the conversation at a later time
- **Different chat views:** You can choose between two chat views: the ‘comfy’ and the ‘compact’ view

**🤖 Choose ANY preferred Large Language Model (LLM)**

- **[Ollama](https://ollama.com/) to integrate LLMs:** Ollama is a tool to run LLMs locally. Its usage is similar to Docker, but it's specifically designed for LLMs. You can use it as an interactive shell, through its REST API, or using it from a Python library.
- **Quickly switch between LLMs:** Comfortably change between different LLMs for different purposes, for example changing from one for scientific writing to one for persuasive writing.
- **Use ChatGPT:** Although, our focus lies on a privacy-focused AI Assistant you can still leverage OpenAI’s models and their advanced capabilities.

# ⚠️ Limitations

- **Performance depends on the chosen LLM:** As LLMs are trained for different tasks, LLMs perform better or worse in embedding notes or generating answers. You can go with our recommendations or find your own best fit.
- **Quality depends on knowledge structure and organization:** The response improves when you have a clear structure and do not mix unrelated information or connect unrelated notes. Therefore, we recommend a well-structured vault and notes.
- **AI Assistant might generate incorrect or irrelevant answers:** Due to a lack of relevant notes or limitations of AI understanding the AI Assistant might generate unsatisfying answers. In those cases, we recommend rephrasing your query or describing the context in more detail

# 🔧 Getting started
>[!NOTE]  
>If you use **Obsidian Sync** the vector store binaries might take up a lot of space due to the version history.  
>Exclude the `.obsidian/plugins/smart-second-brain/vectorstores` folder in the Obsidian Sync settings to avoid this.

Follow the onboarding instructions provided on initial plugin startup in Obsidian.

# 🎯 Roadmap

- Support Gemini and Claude models and integrate KoboldCpp
- Similar note connections view
- Chat Threads
- Hybrid Vector Search
- Predictive Note Placement
- Agent with Obsidian tooling
- Multimodality

# 👨‍🎓 About us

We initially made this plugin as part of a university project, which is now complete. However, we are still fully committed to developing and improving the assistant in our spare time.
This and the [papa-ts](https://github.com/your-papa/papa-ts) (backend) repo serve as an experimental playground, allowing us to explore state-of-the-art AI topics further and as a tool to enrich the obsidian experience we’re so passionate about.
If you have any suggestions or wish to contribute, we would greatly appreciate it.
