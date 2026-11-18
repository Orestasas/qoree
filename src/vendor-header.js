/*!
 * ═════════════════════════════════════════════════════════════════════════════
 * VENDORED CODE (not written for this wallet; embedded unmodified)
 * ═════════════════════════════════════════════════════════════════════════════
 * 1) Official Qubic TypeScript SDK: github.com/qubic/qubic-typescript
 *      @qubic.org/crypto 1.0.0  npm sha512-u4NEQfjthPqsH3R9l9kxRc30piAE009qaM344qPUFoka2IqIMPdcWJL6kpYdj2LhAFMIO3dFT7Udc4pmUueG6g==
 *      @qubic.org/tx     1.0.0  npm sha512-ycpAgZ4h+PRYXesOhCOt83GFyCsLF9fdGsf2dxdc1+WNe3opcR32/RvHCthOLTgh3Ij9o9FV/oi2uq4UWnbtgw==
 *      @qubic.org/types  1.0.0  npm sha512-WS5soiLiizga3x7i0ccBN+CQnCbDhgFXAlEEiB7Vt6r1rEEGL4n5R/PJRulJSIj5l3DDQC8Fpeln73VeZqSoCQ==
 *    Published sources are identical to git commit a4cfb4075097c61d5e0446c2d93910aba637da6e.
 *    @qubic.org/crypto's published bundle includes @noble/hashes 2.2.0 (KangarooTwelve / KT128).
 *    FourQ + SchnorrQ are a port of Cloudflare CIRCL and Qubic's Go/C++ reference code.
 *    For message signing the bundle also compiles the package's own src/fourq-constants.ts, fp.ts, fq.ts, fourq.ts and schnorrq.ts (type annotations stripped by esbuild; see build/entry.js).
 * 2) @noble/hashes 2.4.0 argon2.js (Argon2id, RFC 9106), MIT, (c) 2022 Paul Miller.
 *      npm sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==
 * 3) QR Code generator library (TypeScript), Copyright (c) Project Nayuki. (MIT License)
 *    git 3c6d0b3cefb4e049dc337e82237c9644399716a8, type annotations stripped by esbuild.
 *
 * (1)+(2) were bundled into one IIFE with esbuild 0.25.10 (no minification, no code changes).
 *
 * Where they are: (1)+(2), then (3), come after this comment, each byte for byte, inside the function
 * whose result is `vendored` (src/assemble.py prints each one's SHA-256). Everything after that function
 * is this wallet's own code (src/js), which receives them as its argument, in this same script: no
 * global name holds them at any point.
 *
 * Verification performed before embedding (scripted, reproducible):
 *   • 300 random seeds: identities and SchnorrQ signatures byte-identical to the production
 *     web wallet's WASM crypto (@qubic-lib/qubic-ts-library 0.1.6, FourQlib + XKCP);
 *     signatures cross-verified both ways; tampered signatures rejected by both.
 *   • 51 KangarooTwelve vectors (0 to 20,000 bytes; 3/32/64-byte outputs) identical to XKCP.
 *   • 656 real mainnet transactions (256 plain transfers): every signature verified and every
 *     transaction hash reproduced from the rebuilt bytes.
 *   • 800 identity checksum checks agree with the official helper.
 *   • Argon2id identical to hash-wasm (used by @qubic.org/vault) and to the RFC 9106 vector.
 *   • 200 identities round-tripped through this QR encoder and an independent decoder (jsQR).
 *   • Seed generator: chi-square over 1.1M letters consistent with uniform.
 *
 * License for (1), Qubic Anti-Military License, reproduced as required:
 *   Permission is hereby granted, perpetual, worldwide, non-exclusive, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 *
 *
 *   1. The Software cannot be used in any form or in any substantial portions for development, maintenance and for any other purposes, in the military sphere and in relation to military products, including, but not limited to:
 *
 *   a. any kind of armored force vehicles, missile weapons, warships, artillery weapons, air military vehicles (including military aircrafts, combat helicopters, military drones aircrafts), air defense systems, rifle armaments, small arms, firearms and side arms, melee weapons, chemical weapons, weapons of mass destruction;
 *
 *   b. any special software for development technical documentation for military purposes;
 *
 *   c. any special equipment for tests of prototypes of any subjects with military purpose of use;
 *
 *   d. any means of protection for conduction of acts of a military nature;
 *
 *   e. any software or hardware for determining strategies, reconnaissance, troop positioning, conducting military actions, conducting special operations;
 *
 *   f. any dual-use products with possibility to use the product in military purposes;
 *
 *   g. any other products, software or services connected to military activities;
 *
 *   h. any auxiliary means related to abovementioned spheres and products.
 *
 *
 *
 *   2. The Software cannot be used as described herein in any connection to the military activities. A person, a company, or any other entity, which wants to use the Software, shall take all reasonable actions to make sure that the purpose of use of the Software cannot be possibly connected to military purposes.
 *
 *
 *
 *   3. The Software cannot be used by a person, a company, or any other entity, activities of which are connected to military sphere in any means. If a person, a company, or any other entity, during the period of time for the usage of Software, would engage in activities, connected to military purposes, such person, company, or any other entity shall immediately stop the usage of Software and any its modifications or alterations.
 *
 *
 *
 *   4. Abovementioned restrictions should apply to all modification, alteration, merge, and to other actions, related to the Software, regardless of how the Software was changed due to the abovementioned actions.
 *
 *
 *
 *   The above copyright notice and this permission notice shall be included in all copies or substantial portions, modifications and alterations of the Software.
 *
 *
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. *
 * License for (2) and (3), MIT: Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so, subject to the following
 * conditions: The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT
 * WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
