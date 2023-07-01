# Obsidian Plugin Template with Svelte and Tailwind CSS

This is a template repository for creating an Obsidian plugin using Svelte and
Tailwind CSS. It provides a basic setup and structure to kickstart your
development process.

Obsidian is a powerful note-taking and knowledge management application. With
the help of this template, you can create a plugin that extends Obsidian's
functionality using Svelte, a popular JavaScript framework for building user
interfaces, along with Tailwind CSS, a utility-first CSS framework.

## Features

- **Svelte integration**: Leverage the power of Svelte to build interactive and
  reactive user interfaces.
- **Tailwind CSS**: Utilize the comprehensive utility classes provided by
  Tailwind CSS to style your plugin.
- **Easy setup**: Get started quickly with a pre-configured project structure
  and build setup.
- **Hot-reloading**: Enjoy fast development cycles with automatic reloading
  during development.
- **Example plugin**: Includes a basic example plugin to help you understand the
  structure and usage.

## Prerequisites

Before you get started, ensure that you have the following software installed:

- [Node.js](https://nodejs.org) (v14 or above)

## Getting Started

To create a new plugin using this template, follow these steps:

1. Click on the **"Use this template"** button at the top of the repository to
   create a new repository based on this template.
2. Clone the newly created repository to your local machine.
3. Open a terminal and navigate to the cloned repository.
4. Install the project dependencies by running the following command:

```bash
npm install
```

5. Start the development server with hot-reloading using the following command:

```bash
npm run dev
```

6. In **Obsidian**, open **Settings**.
7. In the side menu, select **Community plugins**.
8. Select **Turn on community plugins**.
9. Under **Installed plugins**, enable the **Obsidian Svelte Plugin** by
   selecting the toggle button next to it.
10. Start **building** your plugin by modifying the example plugin located in
    the src directory. You can also create new components and files as needed.
11. Once you're ready to bundle your plugin for **production**, run the
    following command:

```bash
npm run build
```

11. The bundled plugin file will be generated in the `build` directory.

## Project Structure

The project structure follows a typical Svelte application structure with a few
additional files specific to Obsidian plugin development. Here's an overview:

- `src/` - Contains the **source code** for your plugin.
  - **main.ts** - The **entry point** for your plugin, initializes the plugin in
    Obsidian.
  - **styles.css** - The global css **styles** for your plugin.
  - `components/` - Contains **Svelte Components**.
    - **Example.svelte** - An example **Svelte Component** for the example
      Obsidian View.
  - `views/` - Contains **Obsidian Views**.
    - **ExampleView.ts** - An example **Obsidian View** with Svelte.
- `build/` - The bundled output directory for the plugin generated by the build
  command.
- **manifest.json** - The plugin manifest file that describes your plugin's
  metadata.

## Resources

Here are some resources to help you get started with building plugins for
Obsidian, Svelte, and Tailwind CSS:

- [Obsidian Plugin API Documentation](https://github.com/obsidianmd/obsidian-api)
- [Svelte Documentation](https://svelte.dev/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

## Contributing

If you encounter any issues or have suggestions for improvements, feel free to
open an issue or submit a pull request. Contributions are welcome!

## License

This template is available under the [MIT License](LICENSE). Feel free to modify
and use it to create your own Obsidian plugins.
