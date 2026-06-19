# Cadastro seguro no Cloudflare Pages

O cadastro agora usa a Pages Function `functions/api/register.js`. Não publique somente os arquivos estáticos: o deploy precisa incluir a pasta `functions`.

## 1. Criar as credenciais no Firebase

No Firebase/Google Cloud, use uma conta de serviço do projeto `ponto-ppf` com acesso ao Firebase Authentication e ao Cloud Firestore. Gere uma chave JSON e copie apenas estes dois valores:

- `client_email`
- `private_key`

Nunca coloque a chave JSON ou a chave privada dentro desta pasta pública.

## 2. Configurar o Cloudflare Pages

No projeto do Pages, abra **Settings > Variables and Secrets** e crie para produção:

- `FIREBASE_PROJECT_ID`: `ponto-ppf`
- `FIREBASE_API_KEY`: a chave Web API do Firebase
- `FIREBASE_CLIENT_EMAIL`: o valor `client_email` da conta de serviço
- `FIREBASE_PRIVATE_KEY`: o valor completo de `private_key`, incluindo `BEGIN PRIVATE KEY` e `END PRIVATE KEY`

Marque `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` como secrets. Repita nos ambientes de preview somente se cadastros de teste forem necessários.

## 3. Publicar

Faça o deploy pelo repositório conectado ao Cloudflare Pages ou pelo Wrangler, preservando esta estrutura:

```text
app.js
index.html
sw.js
functions/
  api/
    register.js
```

Uploads que publiquem apenas arquivos estáticos não ativam `/api/register`.

## 4. Testar depois do deploy

1. Abra o site em uma janela anônima.
2. Faça um cadastro novo.
3. Confirme no Firebase Authentication que a conta foi criada.
4. Confirme no Firestore o documento em `pessoas/{uid}` com status `pendente`.
5. Tente novamente com o mesmo CPF ou matrícula e confirme que o cadastro é recusado.

O backend cria documentos hashados em `_cadastroUnicos`. Essa coleção não contém CPF, matrícula, nome ou e-mail em texto puro e não precisa de acesso público nas regras do Firestore.

O deploy também precisa incluir estes endpoints:

- `/api/auth/resolve-login`: login e recuperação por CPF/matrícula sem leitura pública do Firestore.
- `PUT /api/register`: atualização segura do próprio perfil e das reservas de unicidade.
- `/api/admin/gecc`: gravação administrativa de GECC no registro de outra pessoa.

Depois do deploy, teste obrigatoriamente login e recuperação por e-mail, CPF e matrícula. No Firebase Authentication, confirme que o provedor **E-mail/Senha** está habilitado, que o domínio publicado está autorizado e que o template de redefinição de senha está configurado.

## Backup e restauração

A tela **Gestão > Pessoas > Backup** usa `/api/admin/backup`:

- Admin e gestor podem baixar um backup JSON de todas as coleções raiz do Firestore.
- Somente admin pode restaurar um JSON.
- A restauração é feita por mesclagem: recria/sobrescreve documentos do arquivo, sem apagar documentos extras existentes.
- O backup não contém senhas nem contas do Firebase Authentication; ele cobre os perfis e demais documentos do Firestore.

### Armazenamento automático no R2

1. No Cloudflare, crie um bucket R2, por exemplo `ponto-ppf-backups`.
2. No projeto Pages, em **Settings > Bindings**, adicione um **R2 bucket binding**:
   - Variable name: `BACKUPS`
   - Bucket: o bucket criado acima.
3. Em **Variables and Secrets**, crie o secret `BACKUP_CRON_SECRET` com um valor longo e aleatório.
4. Copie `workers/wrangler.backup.toml.example` para um arquivo de configuração privado, ajuste `BACKUP_URL` para o domínio do site e publique `workers/backup-cron.js` como Worker.
5. No Worker, configure `BACKUP_CRON_SECRET` com exatamente o mesmo valor usado no Pages.

O exemplo executa diariamente às `03:00 UTC` e mantém os 30 backups automáticos mais recentes no R2.
