# Backup e recuperação

`multiatendimento-db-backup.sh` gera um dump SQL consistente com `pg_dump`, compacta e valida o arquivo, arquiva `/srv/multiatendimento/uploads` (incluindo mídias e documentos de conhecimento) e publica um par com carimbo UTC no volume Docker `multiatendimento_db_backups`. O marcador `.complete` identifica um par concluído. Mantém os arquivos `multiatendimento-latest.sql.gz` e `multiatendimento-latest.uploads.tar.gz` para compatibilidade e retém snapshots por 30 dias. Falha de dump ou mídia impede a atualização do último backup. O código de saída deve ser monitorado pelo agendador.

Execute no servidor Linux com Docker e `flock` disponíveis:

```bash
bash ops/multiatendimento-db-backup.sh
bash ops/verify-backup-restore.sh
# Verificar uma versão específica:
bash ops/verify-backup-restore.sh 20260912T030000Z
```

Configurações opcionais: `BACKUP_VOLUME`, `BACKUP_IMAGE` (padrão `postgres:17`), `BACKUP_RETENTION_DAYS` (mínimo 1) e `UPLOADS_PATH`. O PostgreSQL de origem é localizado pelo nome do serviço `multiatendimento_postgres.1`; o banco é `multiatendimento_db`. Use a mesma versão principal de PostgreSQL da origem para o ensaio. O ensaio restaura em um container novo, sem rede nem portas publicadas, com dados temporários em memória; requer RAM suficiente para o banco. Remove somente esse container ao terminar, inclusive em caso de falha. A restauração de SQL usa `ON_ERROR_STOP`; a mídia passa por leitura integral do arquivo tar. Não restaura sobre produção.

Agende o backup diariamente e o ensaio semanalmente. Copie pares com `.complete` para armazenamento externo com controle de acesso e retenção independente: o volume no mesmo servidor não protege contra perda do servidor. Dumps e mídias contêm dados de clientes; restrinja o acesso ao volume e aos arquivos exportados.

## Consistência e recuperação real

O dump é consistente no instante de sua abertura; a cópia de uploads ocorre em seguida. Para uma cópia conjunta estritamente consistente, coloque o sistema em manutenção e suspenda gravações/remoções de arquivos durante o backup. Sem essa pausa, arquivos novos podem existir no tar sem referência no dump; arquivos removidos ou alterados durante a cópia podem exigir outro snapshot. O script falha se `tar` detectar alterações durante a leitura. Não existe garantia de consistência entre dois sistemas de armazenamento ativos.

Antes de recuperar um incidente, ensaie o par escolhido e confirme seu marcador `.complete`. Crie um banco novo e um diretório de uploads novo; restaure o SQL e extraia o tar nesses destinos vazios. Confira contagens, acesso autenticado a mídias e conversas, além das configurações e segredos do ambiente (mantidos separadamente). Mantenha a aplicação em manutenção durante a troca das referências de banco e uploads. Preserve os destinos anteriores até concluir a validação. Mensagens externas enviadas após o snapshot não são desfeitas por uma restauração: reconcilie agendamentos pendentes com o histórico do provedor antes de reativar os processadores, para evitar reenvios.

## Validação local

`bash -n ops/multiatendimento-db-backup.sh ops/verify-backup-restore.sh` verifica sintaxe. O ensaio efetivo precisa do Docker e de um backup no servidor; a validação sintática não comprova uma restauração.
