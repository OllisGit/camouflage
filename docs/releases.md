# Releases

### 1.0.2 - 04/17/2021

- Fix regex to recognize HTTP/1.0, HTTP/1.1 and HTTP/2. HTTP/2 Camouflage server is not implemented yet but will be in future.
- Use os.EOL to split the contents of .mock file into arrays instead of \n. This helps with cross platform compatibility.
- Add scrapping endpoint for prometheus: /metrics
- Add Camouflage endpoints for mocks management from a possible future UI

      - GET /mocks - List available mocks
      - DELETE /mocks - Delete selected mock

- Start a new worker if for some reason any of the workers go down. This will ensure high availability so that at any time, a fixed number of workers will always be available as specified by -n X command line parameter
- Add a local copy of documentation at root (http://localhost:8080/)
- Camouflage can now be started by simply running camouflage command from the mocks dir. (_-m flag is now optional in case user wants to explicitly provide the path instead of navigating to mocks_dir._)
