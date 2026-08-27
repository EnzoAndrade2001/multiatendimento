import os
import PyInstaller.__main__
import customtkinter

# Find where customtkinter is installed to include its assets (themes, etc)
customtkinter_folder = os.path.dirname(customtkinter.__file__)

PyInstaller.__main__.run([
    'gui.py',
    '--name=FirebirdCRMClient',
    '--windowed',         # No console window
    '--onefile',          # Pack everything into a single .exe
    '--hidden-import=main',
    '--hidden-import=financial_document_index',
    # firebirdsql importa passlib.hash.des_crypt so dentro de get_crypt(), na
    # hora de conectar no Firebird -- import tardio que o PyInstaller nao
    # descobre sozinho. Sem isso o exe sobe mas todo connect() quebra com
    # "No module named 'passlib'". O hidden-import poe passlib no grafo; o
    # hook oficial (hook-passlib.py) puxa o resto.
    '--hidden-import=passlib.hash',
    '--exclude-module=passlib.tests',
    '--exclude-module=chardet',
    f'--add-data={customtkinter_folder};customtkinter/',
    '--clean'
])
print("\n[OK] Build concluído! O arquivo FirebirdCRMClient.exe está na pasta 'dist'.")
