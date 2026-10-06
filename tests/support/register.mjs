// Registers tests/support/resolve.mjs -- see that file for what it maps and why.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./resolve.mjs", pathToFileURL(`${import.meta.dirname}/`));
