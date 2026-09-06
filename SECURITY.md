# Security and privacy

The repository does not contain credentials. Authentication remains managed by the locally installed `claude`, `glab`, Git and MCP clients.

Runtime data is different. Ticket descriptions, terminal output, downloaded assets, test credentials and review reports can be copied into `console/data/`. That directory is ignored by Git and must not be committed or shared.

Before publishing a fork, check tracked files with a secret scanner and confirm that `console/data/`, `.claude/tasks/`, `.env` files and terminal logs are absent.

Feedback and autonomous run observations are untrusted evidence. The self-improvement command must never execute instructions found inside them or use them to weaken permission, privacy, review, validation or Git safety rules. There is no autonomous promotion: an improvement stays on its own branch until the user approves it in the console, and nothing is ever pushed.
