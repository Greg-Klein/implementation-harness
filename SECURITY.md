# Security and privacy

The repository does not contain credentials. Authentication remains managed by the locally installed `claude`, `glab`, Git and MCP clients.

Runtime data is different. Ticket descriptions, terminal output, downloaded assets, test credentials and review reports can be copied into `harness/data/`. That directory is ignored by Git and must not be committed or shared.

Before publishing a fork, check tracked files with a secret scanner and confirm that `harness/data/`, `.claude/tasks/`, `.env` files and terminal logs are absent.
