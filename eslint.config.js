import { defineConfig, globalIgnores } from 'eslint/config';
import ts from 'eslint-config-cheminfo-typescript';

const config = defineConfig(globalIgnores(['coverage', 'lib']), ts);

export default config;
