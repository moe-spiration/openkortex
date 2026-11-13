import base from "../../eslint.config.mjs";

export default [...base, { ignores: [".expo/**", "dist/**", "expo-env.d.ts", "assets/**"] }];
