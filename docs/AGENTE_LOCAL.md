# Central do Agente Local

O executável do agente não deve ser armazenado no filesystem temporário do container. No EasyPanel, crie um volume persistente para o serviço `backend` e monte-o em:

```text
/data/agent-releases
```

Depois copie para essa pasta o arquivo:

```text
FirebirdCRMClient.exe
```

Configure no serviço:

```text
FIREBIRD_AGENT_RELEASE_DIR=/data/agent-releases
FIREBIRD_AGENT_FILE_NAME=FirebirdCRMClient.exe
FIREBIRD_AGENT_VERSION=1.0.6
```

O volume não é apagado quando o backend recebe um novo deploy. A rota protegida `/api/settings/agent-download` só permite o download a usuários com `settings.agent.manage`.

## Publicação de uma nova versão

1. Substitua o executável no volume persistente.
2. Atualize `FIREBIRD_AGENT_VERSION`.
3. Gere o SHA-256 do arquivo e preencha `FIREBIRD_AGENT_SHA256`.
4. Reinicie o serviço ou atualize as variáveis no EasyPanel.
5. Na aba **Agente Local**, clique em **Atualizar** e confirme a versão e o hash.

Se o arquivo ainda não estiver no volume, a tela oferece a URL externa de contingência definida em `FIREBIRD_AGENT_DOWNLOAD_URL`.
