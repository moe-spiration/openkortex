/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads app.config.js as CommonJS */
// Dynamic layer over app.json. Static config stays in app.json (release-check and humans read it there);
// this only adds update code signing when certs/certificate.pem exists. Signing is optional (it needs the EAS
// Production plan or an own update server); without the file updates are simply unsigned.
//
// Signing = the app only accepts updates signed with the private key that belongs to certs/certificate.pem.
// The private key is never in the repo: KORTEX_EAS_CODESIGN_KEY points at it (apps/mobile/certs/README.md).
const fs = require("node:fs");
const path = require("node:path");

module.exports = ({ config }) => {
  const certificate = "./certs/certificate.pem";
  if (!fs.existsSync(path.join(__dirname, certificate))) return config;
  return {
    ...config,
    updates: {
      ...config.updates,
      codeSigningCertificate: certificate,
      codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
    },
  };
};
