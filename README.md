# PacketSniffer

### Web testing toolkit

**A modern desktop cybersecurity workbench for HTTP traffic inspection, interception, and web application security testing.**

PacketSniffer brings essential web security testing capabilities into a unified desktop application, combining traffic analysis, request manipulation, automated testing, and AI-assisted security insights.

---

## Overview

PacketSniffer is an open-source desktop security testing project designed for penetration testers, security researchers, developers, and students learning web application security.

Instead of switching between multiple tools, PacketSniffer provides a unified workspace to capture, inspect, modify, and analyze HTTP/HTTPS traffic while exploring potential security vulnerabilities.

## Features

### 🌐 Proxy & Traffic Inspection

- Intercept and inspect HTTP/HTTPS traffic.
- View complete HTTP requests and responses.
- Examine headers, cookies, parameters, and request bodies.
- Inspect response content and decoded data.
- Maintain a searchable traffic history.

### 🛡️ Interception & Request Control

- Intercept requests and responses.
- Forward intercepted traffic.
- Modify requests before forwarding.
- Control the flow of intercepted traffic.

### 🔁 Repeater

- Manually resend HTTP requests.
- Modify parameters, headers, and request bodies.
- Compare server responses during security testing.
- Investigate application behavior through repeated requests.

### ⚡ Intruder

- Perform automated request-based testing.
- Configure payloads and attack types.
- Execute controlled testing operations.
- Review individual attack results.

### 🤖 AI Security Intelligence

Powered by Google Gemini, PacketSniffer provides an AI-assisted workspace for understanding web traffic and security behavior.

- Analyze HTTP requests and responses.
- Understand potentially vulnerable request patterns.
- Get explanations of security-related behavior.
- Ask questions about HTTP traffic and application security.
- Select supported Gemini models using your own API configuration.

### 🔌 WebSocket Inspection

- Capture WebSocket communication.
- Inspect recorded WebSocket frames.
- Examine communication during application testing.

---

## Interface

PacketSniffer is designed as a desktop-first security workbench with a modern dark interface.

The goal is to keep traffic inspection, testing tools, and security intelligence accessible from one workspace.

<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/64e7ef94-4b20-467b-bc08-2ae353a51a1b" />
<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/bf72b67f-0fca-4381-9da7-c4d84349ec03" />
<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/16688aad-45bc-4be5-a2ff-676d7ecd8390" />
<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/815c8fff-3f72-4e55-b41d-31521d63df0a" />
<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/2712f786-5896-415c-a072-79261f925c50" />


---

## Technology Stack

| Component             | Technology                 |
| --------------------- | -------------------------- |
| Desktop Framework     | Tauri                      |
| Frontend              | Next.js, React, TypeScript |
| UI Styling            | Tailwind CSS               |
| Backend               | Python, FastAPI            |
| Traffic Processing    | Custom HTTP proxy engine   |
| Database              | SQLite                     |
| AI Integration        | Google Gemini              |
| Desktop Communication | Tauri                      |

---

## Installation

Download the latest available build from the GitHub Releases page.

[**Download PacketSniffer**](../../releases/latest)

### Linux

1. Open the Releases page.
2. Download the Linux package for your system.
3. Follow the installation instructions for the downloaded package.
4. Launch PacketSniffer.

### Windows

Windows distribution builds are also available through the project's release distribution.

Check the Releases page for the available installers.

> **Note:** Available packages and supported architectures may vary between releases.

---

## Getting Started

1. Install and launch PacketSniffer.
2. Open the Proxy Engine workspace.
3. Configure your browser to use the PacketSniffer proxy.
4. Install and trust the PacketSniffer CA certificate when HTTPS inspection is required.
5. Browse your authorized test application.
6. Inspect captured traffic and use the available testing tools.

**Important:** Only install and trust the CA certificate on devices and browsers you control or are authorized to test.

---

## AI Configuration

PacketSniffer's AI functionality uses Google Gemini.

To configure it:

1. Obtain a Gemini API key from [Google AI Studio](https://aistudio.google.com/).
2. Open PacketSniffer's AI settings.
3. Configure your API key.
4. Select an available Gemini model.
5. Test the connection and start using AI-assisted analysis.

Your API key should be kept private and must never be committed to the repository.

---

## Project Status

PacketSniffer is actively evolving.

The project is currently in its early release stage. Features, interface components, and internal architecture may change as development progresses.

We welcome bug reports, suggestions, and contributions from the cybersecurity community.

---

## Security & Responsible Usage

PacketSniffer is intended for legitimate security research, authorized penetration testing, educational purposes, and application debugging.

By using this software, you agree to:

- Test only systems you own or have explicit permission to assess.
- Respect applicable laws and regulations.
- Protect captured traffic and sensitive information.
- Avoid exposing private credentials, tokens, or personal data.

The developers are not responsible for misuse of this software.

---

## Contributing

Contributions are welcome!

If you want to improve PacketSniffer:

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Test your implementation.
5. Submit a Pull Request describing your changes.

For bugs or feature requests, please open an issue in the repository.

---

## Roadmap

Some areas of continued development include:

- Improved HTTP/HTTPS traffic analysis.
- Enhanced request and response manipulation.
- More advanced security testing capabilities.
- Improved AI-powered vulnerability analysis.
- Better WebSocket testing and inspection.
- Additional desktop platform support.
- Performance and user experience improvements.
- Extensible architecture for future testing modules.

---

## Acknowledgements

PacketSniffer is inspired by the broader open-source cybersecurity and web application security community.

Special appreciation to everyone building tools, sharing research, and making security testing more accessible.

---

## License

See the [LICENSE](LICENSE) file for licensing information.

---

\<p align="center">

**PacketSniffer — Security Workbench**

*Inspect. Intercept. Analyze. Secure.*

\</p>
