import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const sharedRules = {
    "no-unused-vars": "warn",
    "no-console": "off",
    "no-undef": "warn"
};

export default defineConfig([
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
    },
    {
        files: ["**/*.ts"],
        extends: [tseslint.configs.recommended],
        rules: {
            "no-undef": "off",
            "no-console": "off",
            "@typescript-eslint/no-unused-vars": "warn"
        }
    }
]);
