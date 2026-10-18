import { fileURLToPath } from "node:url";

console.log("argv[1]:", process.argv[1]);
console.log("module :", fileURLToPath(import.meta.url));
console.log("guard  :", process.argv[1] === fileURLToPath(import.meta.url));
