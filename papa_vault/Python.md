---
related:
- "[[Programming]]"
created_at:  "10-11-2022 00:00"
type: PL
---
# LSP
---
```bash
pip install 'python-language-server[all]'
```
and get [pylsp-rope](https://github.com/python-rope/pylsp-rope) and pynvim
For that create a virtual environment in ~/.virtualenvs/ called neovim and install pynvim there

[How to set up a python project and development environment - Samuel Dowling](https://www.samueldowling.com/2020/06/08/how-to-set-up-a-python-project-and-development-environment/)
flake8, python-lsp-black

[https://github.com/python-lsp/python-lsp-server](https://github.com/python-lsp/python-lsp-server)
for specifc configurations of formater etc lookup configuration.md

# Debugger
---
need to install debugpy in [venv home dir](https://github.com/mfussenegger/nvim-dap-python#debugpy)

# Tensorflow
---
[Install TensorFlow with pip](https://www.tensorflow.org/install/pip)
Dependencies to install:
- **CUDA® Toolkit 9.0**
- **cuDNN v7.0**
- The NVIDIA drivers associated with CUDA Toolkit 9.0.
- GPU card with CUDA Compute Capability 3.0 or higher.

in venv activated:
```bash
pip3 install --upgrade tensorflow tensorflow-gpu
```

💡 you need to install pynvim with pip in order to get jedi to work

# Jupyter Notebook in nvim
---
install dependencies:
[https://github.com/dccsillag/magma-nvim](https://github.com/dccsillag/magma-nvim)

and install these [dependencies](https://github.com/seebye/ueberzug#dependencies): libxres, libxrex

if get error look this [thread](https://stackoverflow.com/questions/69759351/error-jupyter-client-kernelspec-nosuchkernel-no-such-kernel-named-python3-occu)
and if there is no MagmaInit command run :[UpdateRemotePlugins](https://github.com/dccsillag/magma-nvim/issues/32)
