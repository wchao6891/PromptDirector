# Third-party notices

## Lucide

PromptDirector includes icons from Lucide.

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## PDF.js

PromptDirector includes the PDF.js display library and worker from Mozilla. The exact version is declared in `package.json`; packaging verifies that every vendored runtime file is byte-identical to that installed version.

PDF.js is licensed under the Apache License 2.0. The complete upstream license is included at `vendor/pdfjs/LICENSE`.

## rtf-toolkit

PromptDirector includes `@jonahschulte/rtf-toolkit` for local RTF parsing. It is licensed under the MIT License; the complete license is included at `vendor/document-ingestion/rtf-toolkit-LICENSE`.

## Turndown

PromptDirector includes Turndown for local HTML-to-Markdown conversion. It is licensed under the MIT License; the complete license is included at `vendor/document-ingestion/turndown-LICENSE`.

## Mozilla Readability

PromptDirector includes Mozilla Readability for local article extraction. It is licensed under the Apache License 2.0; the complete license is included at `vendor/document-ingestion/readability-LICENSE`.

## @noble/hashes

Incremental SHA-256 for library file integrity verification. MIT licensed. Source: https://github.com/paulmillr/noble-hashes . The pinned version is recorded in package-lock.json; its license is included in vendor/noble-hashes/LICENSE.

## hls.js

Bundled local video playback runtime. Exact version: package-lock.json. Source: https://github.com/video-dev/hls.js

Copyright (c) 2017 Dailymotion (http://www.dailymotion.com)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

src/remux/mp4-generator.js and src/demux/exp-golomb.ts implementation in this project
are derived from the HLS library for video.js (https://github.com/videojs/videojs-contrib-hls)

That work is also covered by the Apache 2 License, following copyright:
Copyright (c) 2013-2015 Brightcove


THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Mammoth

Browser DOCX content extraction. BSD-2-Clause licensed. Source: https://github.com/mwilliamson/mammoth.js . Exact version is pinned in package-lock.json; its license is included in vendor/document-ingestion/mammoth-LICENSE. Bundled dependency licenses are included in vendor/document-ingestion/mammoth-THIRD-PARTY-NOTICES; build checks bind these notices to the exact browser runtime. JSZip is used under its MIT license option.
