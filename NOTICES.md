# Third-Party Notices

This file contains required notices and attributions for third-party components used in Mimir.

## Apache License 2.0 Components

The following components are licensed under the Apache License 2.0:

### Neo4j Driver

- **Package**: neo4j-driver@6.0.1 (including neo4j-driver-core, neo4j-driver-bolt-connection)
- **Copyright**: Copyright (c) "Neo4j"
- **License**: Apache-2.0
- **Repository**: https://github.com/neo4j/neo4j-javascript-driver
- **License Text**: See https://www.apache.org/licenses/LICENSE-2.0

### Sharp (Image Processing)

- **Package**: sharp@0.34.5 (including @img/sharp-darwin-arm64)
- **Copyright**: Copyright 2013 Lovell Fuller and contributors
- **License**: Apache-2.0
- **Repository**: https://github.com/lovell/sharp
- **License Text**: See https://www.apache.org/licenses/LICENSE-2.0
- **Notice**: High performance Node.js image processing library

### OpenAI SDK

- **Package**: openai@6.9.0
- **Copyright**: Copyright (c) OpenAI
- **License**: Apache-2.0
- **Repository**: https://github.com/openai/openai-node
- **License Text**: See https://www.apache.org/licenses/LICENSE-2.0

### TypeScript

- **Package**: typescript@5.9.3
- **Copyright**: Copyright (c) Microsoft Corporation
- **License**: Apache-2.0
- **Repository**: https://github.com/microsoft/TypeScript
- **License Text**: See https://www.apache.org/licenses/LICENSE-2.0

### RxJS

- **Package**: rxjs@7.8.2
- **Copyright**: Copyright (c) 2015-2018 Google, Inc., Netflix, Inc., Microsoft Corp. and contributors
- **License**: Apache-2.0
- **Repository**: https://github.com/ReactiveX/rxjs
- **License Text**: See https://www.apache.org/licenses/LICENSE-2.0

### PDF.js

- **Package**: pdfjs-dist@5.4.296
- **Copyright**: Copyright (c) Mozilla Foundation
- **License**: Apache-2.0
- **Repository**: https://github.com/mozilla/pdf.js
- **License Text**: See https://www.apache.org/licenses/LICENSE-2.0

### PDF Parse

- **Package**: pdf-parse@2.4.5
- **Copyright**: Copyright (c) 2018 Modesty Zhang
- **License**: Apache-2.0
- **Repository**: https://gitlab.com/autokent/pdf-parse
- **License Text**: See https://www.apache.org/licenses/LICENSE-2.0

### Other Apache-2.0 Components

- **b4a@1.7.3** - Buffer utilities
- **bare-events@2.8.2** - Event emitter
- **crc-32@1.2.2** - CRC-32 implementation
- **detect-libc@2.1.2** - Libc detection
- **ecdsa-sig-formatter@1.0.11** - ECDSA signature formatting
- **eslint-visitor-keys@4.2.1** - ESLint visitor keys
- **events-universal@1.0.1** - Universal events
- **readdir-glob@1.1.3** - Directory reading with glob
- **text-decoder@1.2.3** - Text decoding utilities

---

## LGPL-3.0-or-later Components

### libvips (via Sharp)

- **Package**: @img/sharp-libvips-darwin-arm64@1.2.4
- **Copyright**: Copyright (c) libvips contributors
- **License**: LGPL-3.0-or-later
- **Repository**: https://github.com/libvips/libvips
- **License Text**: See https://www.gnu.org/licenses/lgpl-3.0.html

**Important Notice**: This component is **dynamically linked** and not statically compiled into Mimir. Users may replace this library with a compatible alternative. This usage complies with LGPL-3.0 requirements and does not impose GPL obligations on Mimir or its users.

**Compliance**:
- ✅ Dynamic linking (not static compilation)
- ✅ Library can be replaced by users
- ✅ Source code available at repository above
- ✅ No modifications made to libvips source

---

## BSD-2-Clause Components

The following components are licensed under BSD-2-Clause:

- **mammoth@1.11.0** - .docx to HTML converter
  - Copyright (c) 2013, Michael Williamson
  
- **cheerio-select@2.1.0** - CSS selector engine
  - Copyright (c) Felix Böhm
  
- **dingbat-to-unicode@1.0.1** - Dingbat conversion
  - Copyright (c) 2014 Desmond Brand
  
- **lop@0.4.2** - List operations
  - Copyright (c) 2014 Quildreen Motta
  
- **uglify-js@3.19.3** - JavaScript minifier
  - Copyright 2012-2019 (c) Mihai Bazon

---

## BSD-3-Clause Components

The following components are licensed under BSD-3-Clause:

- **buffer-equal-constant-time@1.0.1** - Constant-time buffer comparison
  - Copyright (c) 2013, GoInstant Inc.
  
- **fast-uri@3.1.0** - Fast URI parser
  - Copyright (c) 2020 Vincent Voyer
  
- **sprintf-js@1.0.3** - sprintf implementation
  - Copyright (c) 2007-2014, Alexandru Marasteanu
  
- **qs@6.14.0** - Query string parser
  - Copyright (c) 2014 Nathan LaFreniere and other contributors

---

## Python-2.0 License

- **argparse@2.0.1** - Argument parser
  - Copyright (c) Python Software Foundation
  - License: Python-2.0
  - Repository: https://github.com/nodeca/argparse

---

## ISC License Components

The following components use the ISC license (functionally equivalent to MIT):

- **graceful-fs@4.2.11** - Improved fs module
- **glob@10.5.0** - Glob pattern matching
- **minimatch@9.0.5** - Minimatch pattern matching
- **lru-cache@10.4.3** - LRU cache implementation
- **semver@7.7.3** - Semantic versioning
- **fastq@1.19.1** - Fast queue implementation
- **signal-exit@4.1.0** - Signal handling
- **yaml@2.8.1** - YAML parser
- **zod-to-json-schema@3.24.6** - Zod to JSON Schema converter

And many others - see LICENSE_AUDIT_REPORT.md for complete list.

---

## MIT License Components

The majority of dependencies (295 packages, 87.3%) use the MIT license, which is the same as Mimir's license. Notable MIT-licensed components include:

- **@langchain/*** - LangChain ecosystem (MIT)
- **@modelcontextprotocol/sdk** - MCP SDK (MIT)
- **express** - Web framework (MIT)
- **chokidar** - File watcher (MIT)
- **dotenv** - Environment variables (MIT)
- **zod** - Schema validation (MIT)
- **vitest** - Testing framework (MIT)

For a complete list of MIT-licensed components, see LICENSE_AUDIT_REPORT.md.

---

## Dual-Licensed Components

### jszip@3.10.1
- **License**: MIT OR GPL-3.0-or-later
- **Our Choice**: MIT (we use the MIT license option)
- **Copyright**: Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso

### pako@1.0.11
- **License**: MIT AND Zlib
- **Note**: Both licenses apply, both are permissive
- **Copyright**: Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

---

## Attribution Requirements Summary

### For Apache-2.0 Components:
1. ✅ Include this NOTICES.md file in distributions
2. ✅ Preserve copyright notices (included above)
3. ✅ Include Apache-2.0 license text (linked above)
4. ✅ State any modifications (none made)
5. ✅ Patent grant automatically applies

### For LGPL-3.0 Components:
1. ✅ Include LGPL-3.0 license text (linked above)
2. ✅ Document dynamic linking (stated above)
3. ✅ Inform users library can be replaced (stated above)
4. ✅ Provide source code location (linked above)

### For BSD Components:
1. ✅ Include copyright notices (included above)
2. ✅ Include license text (standard BSD text applies)
3. ✅ Do not use names for endorsement (BSD-3-Clause)

---

## Full License Texts

For complete license texts, see:

- **Apache-2.0**: https://www.apache.org/licenses/LICENSE-2.0.txt
- **LGPL-3.0**: https://www.gnu.org/licenses/lgpl-3.0.txt
- **MIT**: https://opensource.org/licenses/MIT
- **ISC**: https://opensource.org/licenses/ISC
- **BSD-2-Clause**: https://opensource.org/licenses/BSD-2-Clause
- **BSD-3-Clause**: https://opensource.org/licenses/BSD-3-Clause

---

## Compliance Statement

Mimir complies with all license requirements of its dependencies:

- ✅ All required attributions included
- ✅ All copyright notices preserved
- ✅ LGPL component dynamically linked (compliant)
- ✅ Apache-2.0 patent grants accepted
- ✅ No modifications made to third-party code
- ✅ All license texts referenced and available

For questions or concerns about licensing, see LICENSE_AUDIT_REPORT.md or consult legal counsel.

---

**Last Updated**: November 24, 2025  
**Next Review**: February 24, 2026 (Quarterly)  
**Maintained By**: Mimir Project Team
