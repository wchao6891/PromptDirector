import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Real temporary disk adapter for the File System Access interface. Chrome permissions
// and native picker behavior require separate browser verification.
function missing(error) { if (error.code === "ENOENT") error.name = "NotFoundError"; return error; }
export function directory(path, fault = () => false) {
  return {
    kind: "directory", name: path.split("/").at(-1), path,
    async getDirectoryHandle(name, { create = false } = {}) {
      const next = join(path, name);
      try { if (create) await mkdir(next, { recursive: true }); await readdir(next); }
      catch (error) { throw missing(error); }
      return directory(next, fault);
    },
    async getFileHandle(name, { create = false } = {}) {
      const next = join(path, name);
      try { await readFile(next); } catch (error) { if (create && error.code === "ENOENT") await writeFile(next, ""); else throw missing(error); }
      return {
        kind: "file", name,
        async getFile() { return new Blob([await readFile(next)]); },
        async createWritable() {
          let content;
          return {
            async write(blob) { content = new Uint8Array(await blob.arrayBuffer()); },
            async close() { if (fault(next)) throw new Error("simulated disk write failure"); await writeFile(next, content); },
            async abort() {}
          };
        }
      };
    },
    async removeEntry(name, { recursive = false } = {}) { try { await rm(join(path, name), { recursive }); } catch (error) { throw missing(error); } },
    async *entries() {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        yield [entry.name, entry.isDirectory() ? directory(join(path, entry.name), fault) : await this.getFileHandle(entry.name)];
      }
    }
  };
}
export function served(path) {
  return async url => {
    try { return new Response(await readFile(join(path, new URL(url).pathname))); }
    catch { return new Response("", { status: 404 }); }
  };
}
