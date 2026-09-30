"use strict";
// tests/support/enc.js (DD-T23): the one place unit tests obtain the encoding module.
//   default                        require("../../src/encoding.js")
//   ENCODING_PARTS_DIR=<dir>       the module assembled in memory from the numbered parts in <dir>
//   ENCODING_ONLY=hash,scale       (with ENCODING_PARTS_DIR) only the requires-closure of those parts,
//                                  so a Wave-1 author can test a part before its neighbours exist
// Tests use the names of API.md directly: const E = require("../support/enc");
const path = require("node:path");

const dir = process.env.ENCODING_PARTS_DIR;
if (dir) {
  const { loadParts } = require("./assemble-encoding.js");
  const only = process.env.ENCODING_ONLY ? process.env.ENCODING_ONLY.split(",").map((s) => s.trim()).filter(Boolean) : null;
  module.exports = loadParts({ dir: path.resolve(dir), only });
} else {
  module.exports = require("../../src/encoding.js");
}
