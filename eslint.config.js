import js from "@eslint/js";
import globals from "globals";

const sharedRules = {
    "no-unused-vars": "warn",
    "no-console": "off",
    "no-undef": "warn"
};

export default [
    { ignores: ["dist/**", "build-tools/**", "out/**", "coverage/**"] },
    js.configs.recommended,
    {
        files: ["**/*.{js,mjs}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
            }
        },
        rules: sharedRules
    },
    {
        files: ["**/*.cjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: {
                ...globals.browser,
                ...globals.node,
            }
        },
        rules: sharedRules
    }
];
