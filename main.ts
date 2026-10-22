import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  arrayBufferToBase64,
  requestUrl,
} from "obsidian";

interface Settings {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  intervalMinutes: number;
  syncOnStartup: boolean;
  syncOnChange: boolean;
}

interface CacheEntry {
  mtime: number;
  size: number;
  sha: string;
}

interface Persisted {
  settings: Settings;
  // Son basarili senkronda her dosyanin GitHub blob sha'si (uc yonlu karsilastirmanin "ortak atasi").
  base: Record<string, string>;
  // Yerel dosyalari her seferinde yeniden hash'lememek icin (mtime + boyut ayni ise sha ayni).
  cache: Record<string, CacheEntry>;
}

const DEFAULT_SETTINGS: Settings = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
  intervalMinutes: 5,
  syncOnStartup: true,
  syncOnChange: true,
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Bir senkronda bundan fazla silme gerekiyorsa bir hata/yanlis ayar olabilir; durdur.
const MAX_DELETES = 25;
const CHANGE_DEBOUNCE_MS = 60_000;

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Noktayla baslayan klasor/dosyalar (.obsidian, .git, .trash ...) senkronlanmaz; token .obsidian icinde durur.
function isIgnored(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

async function gitBlobSha(buf: ArrayBuffer): Promise<string> {
  const header = new TextEncoder().encode(`blob ${buf.byteLength}\0`);
  const all = new Uint8Array(header.length + buf.byteLength);
  all.set(header);
  all.set(new Uint8Array(buf), header.length);
  const digest = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function conflictPath(path: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  if (dot > slash + 1) return `${path.slice(0, dot)} (çakışma ${stamp})${path.slice(dot)}`;
  return `${path} (çakışma ${stamp})`;
}

export default class GithubVaultSync extends Plugin {
  data!: Persisted;
  private syncing = false;
  private timerId: number | null = null;
  private debounceId: number | null = null;

  async onload() {
    const saved = (await this.loadData()) as Partial<Persisted> | null;
    this.data = {
      settings: { ...DEFAULT_SETTINGS, ...saved?.settings },
      base: saved?.base ?? {},
      cache: saved?.cache ?? {},
    };

    this.addSettingTab(new SyncSettingTab(this.app, this));
    this.addRibbonIcon("refresh-cw", "GitHub ile senkronla", () => this.sync(true));
    this.addCommand({ id: "sync-now", name: "GitHub ile şimdi senkronla", callback: () => this.sync(true) });

    this.app.workspace.onLayoutReady(() => {
      if (this.data.settings.syncOnStartup) void this.sync();
      this.setupTimer();
      // Olaylar yerlesim hazir olduktan sonra baglanir; yoksa acilista her dosya icin "create" tetiklenir.
      const onChange = () => this.scheduleChangeSync();
      this.registerEvent(this.app.vault.on("create", onChange));
      this.registerEvent(this.app.vault.on("modify", onChange));
      this.registerEvent(this.app.vault.on("delete", onChange));
      this.registerEvent(this.app.vault.on("rename", onChange));
    });
  }

  onunload() {
    if (this.timerId !== null) window.clearInterval(this.timerId);
    if (this.debounceId !== null) window.clearTimeout(this.debounceId);
  }

  async savePersisted() {
    await this.saveData(this.data);
  }

  setupTimer() {
    if (this.timerId !== null) window.clearInterval(this.timerId);
    this.timerId = null;
    const minutes = this.data.settings.intervalMinutes;
    if (minutes > 0) {
      this.timerId = window.setInterval(() => void this.sync(), minutes * 60_000);
    }
  }

  private scheduleChangeSync() {
    if (this.syncing || !this.data.settings.syncOnChange) return;
    if (this.debounceId !== null) window.clearTimeout(this.debounceId);
    this.debounceId = window.setTimeout(() => void this.sync(), CHANGE_DEBOUNCE_MS);
  }

  private async api(method: string, path: string, body?: unknown, raw = false) {
    const { token, owner, repo } = this.data.settings;
    const res = await requestUrl({
      url: `https://api.github.com/repos/${owner}/${repo}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      contentType: body === undefined ? undefined : "application/json",
      throw: false,
    });
    if (res.status >= 400) throw new ApiError(res.status, `${method} ${path} -> ${res.status}: ${res.text.slice(0, 300)}`);
    return res;
  }

  async sync(manual = false) {
    const s = this.data.settings;
    if (!s.token || !s.owner || !s.repo) {
      if (manual) new Notice("GitHub Vault Sync: önce ayarlardan token, kullanıcı ve depo girin.");
      return;
    }
    if (this.syncing) return;
    this.syncing = true;
    if (this.debounceId !== null) window.clearTimeout(this.debounceId);
    this.debounceId = null;

    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await this.syncOnce();
          if (manual || r.down || r.up || r.conflicts) {
            new Notice(
              `GitHub senkron tamam: ↓${r.down} ↑${r.up} silinen ${r.deleted}` +
                (r.conflicts ? ` · ${r.conflicts} çakışma (dosya adında "çakışma" geçen kopyalara bakın)` : ""),
            );
          }
          break;
        } catch (e) {
          // 409/422: ayni anda baska bir commit dala girdi (ornegin bot); bastan oku ve tekrar dene.
          if (e instanceof ApiError && (e.status === 409 || e.status === 422) && attempt < 3) continue;
          throw e;
        }
      }
    } catch (e) {
      console.error(e);
      new Notice(`GitHub senkron hatası: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.syncing = false;
    }
  }

  private async syncOnce() {
    const adapter = this.app.vault.adapter;
    const branch = this.data.settings.branch;
    const base = this.data.base;

    // --- Uzak durum ---
    const headSha: string = (await this.api("GET", `/git/ref/heads/${branch}`)).json.object.sha;
    const treeSha: string = (await this.api("GET", `/git/commits/${headSha}`)).json.tree.sha;
    const tree = (await this.api("GET", `/git/trees/${treeSha}?recursive=1`)).json;
    if (tree.truncated) throw new Error("Depo ağacı çok büyük, GitHub kesti; senkron durduruldu.");

    const remote = new Map<string, string>();
    for (const item of tree.tree as { path: string; type: string; sha: string }[]) {
      if (item.type === "blob" && !isIgnored(item.path)) remote.set(item.path, item.sha);
    }

    // --- Yerel durum ---
    const local = new Map<string, string>();
    const nextCache: Record<string, CacheEntry> = {};
    let skipped = 0;
    for (const file of this.app.vault.getFiles()) {
      if (isIgnored(file.path)) continue;
      if (file.stat.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      const cached = this.data.cache[file.path];
      let sha: string;
      if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
        sha = cached.sha;
      } else {
        sha = await gitBlobSha(await adapter.readBinary(file.path));
      }
      nextCache[file.path] = { mtime: file.stat.mtime, size: file.stat.size, sha };
      local.set(file.path, sha);
    }

    // Uzak ağaç bos geldi ama daha once dosya senkronlanmissa, bir sorun vardir; yerel dosyalari silme.
    if (remote.size === 0 && Object.keys(base).length > 0) {
      throw new Error("Uzak depo boş görünüyor; yerel dosyaları silmemek için senkron durduruldu.");
    }

    // --- Plan (L=yerel, R=uzak, B=son senkron) ---
    const downloads: { path: string; sha: string }[] = [];
    const localDeletes: string[] = [];
    const uploads: string[] = [];
    const remoteDeletes: string[] = [];
    const conflicts: { path: string; sha: string }[] = [];
    const nextBase: Record<string, string> = {};

    const paths = new Set<string>([...remote.keys(), ...local.keys(), ...Object.keys(base).filter((p) => !isIgnored(p))]);
    for (const p of paths) {
      const L = local.get(p);
      const R = remote.get(p);
      const B = base[p];

      if (L === R) {
        if (L) nextBase[p] = L;
      } else if (L === B) {
        // Yerel degismedi, uzak degisti.
        if (R) {
          downloads.push({ path: p, sha: R });
          nextBase[p] = R;
        } else {
          localDeletes.push(p);
        }
      } else if (R === B) {
        // Uzak degismedi, yerel degisti.
        if (L) {
          uploads.push(p);
          nextBase[p] = L;
        } else {
          remoteDeletes.push(p);
        }
      } else if (!L && R) {
        // Yerelde silinmis ama uzakta degismis: veriyi kaybetme, uzagi geri indir.
        downloads.push({ path: p, sha: R });
        nextBase[p] = R;
      } else if (!R && L) {
        // Uzakta silinmis ama yerelde degismis: yerel kalsin, geri yukle.
        uploads.push(p);
        nextBase[p] = L;
      } else if (L && R) {
        // Iki taraf da degisti: uzak surumu yan dosya olarak indir, yerel surumu yukle.
        conflicts.push({ path: p, sha: R });
        uploads.push(p);
        nextBase[p] = L;
      }
    }

    if (localDeletes.length + remoteDeletes.length > MAX_DELETES) {
      throw new Error(
        `Tek senkronda ${localDeletes.length + remoteDeletes.length} silme gerekiyor (sınır ${MAX_DELETES}); olası hata, senkron durduruldu.`,
      );
    }
    if (skipped) new Notice(`${skipped} dosya ${MAX_FILE_BYTES / 1024 / 1024} MB'tan büyük olduğu için atlandı.`);

    // --- Yerel degisiklikleri uygula ---
    const ensureFolder = async (filePath: string) => {
      const parts = filePath.split("/").slice(0, -1);
      let cur = "";
      for (const part of parts) {
        cur = cur ? `${cur}/${part}` : part;
        if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
      }
    };
    const fetchBlob = async (sha: string) => (await this.api("GET", `/git/blobs/${sha}`, undefined, true)).arrayBuffer;
    const writeLocal = async (path: string, sha: string) => {
      const data = await fetchBlob(sha);
      await ensureFolder(path);
      await adapter.writeBinary(path, data);
      const stat = await adapter.stat(path);
      if (stat) nextCache[path] = { mtime: stat.mtime, size: stat.size, sha };
    };

    for (const d of downloads) await writeLocal(d.path, d.sha);
    for (const c of conflicts) {
      const cp = conflictPath(c.path);
      await writeLocal(cp, c.sha);
    }
    for (const p of localDeletes) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) await this.app.fileManager.trashFile(f);
      delete nextCache[p];
    }

    // --- Uzak degisiklikleri tek commit olarak gonder ---
    const entries: { path: string; mode: string; type: string; sha: string | null }[] = [];
    for (const p of uploads) {
      const data = await adapter.readBinary(p);
      const blob = await this.api("POST", "/git/blobs", { content: arrayBufferToBase64(data), encoding: "base64" });
      entries.push({ path: p, mode: "100644", type: "blob", sha: blob.json.sha });
    }
    for (const p of remoteDeletes) entries.push({ path: p, mode: "100644", type: "blob", sha: null });

    if (entries.length) {
      const newTree = await this.api("POST", "/git/trees", { base_tree: treeSha, tree: entries });
      const newCommit = await this.api("POST", "/git/commits", {
        message: `obsidian: sync (+${uploads.length} -${remoteDeletes.length})`,
        tree: newTree.json.sha,
        parents: [headSha],
      });
      // force:false (varsayilan) -> baska bir commit girdiyse 422 doner, ust dongu bastan dener.
      await this.api("PATCH", `/git/refs/heads/${branch}`, { sha: newCommit.json.sha });
    }

    this.data.base = nextBase;
    this.data.cache = nextCache;
    await this.savePersisted();

    return {
      down: downloads.length + conflicts.length,
      up: uploads.length,
      deleted: localDeletes.length + remoteDeletes.length,
      conflicts: conflicts.length,
    };
  }
}

class SyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: GithubVaultSync) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.data.settings;
    const save = async () => this.plugin.savePersisted();

    new Setting(containerEl)
      .setName("GitHub token")
      .setDesc("Fine-grained token: yalnızca bu depo, Contents: Read and write. Bu cihazda saklanır, senkronlanmaz.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(s.token).onChange(async (v) => {
          s.token = v.trim();
          await save();
        });
      });

    new Setting(containerEl).setName("Kullanıcı / organizasyon").addText((t) =>
      t.setValue(s.owner).onChange(async (v) => {
        s.owner = v.trim();
        await save();
      }),
    );
    new Setting(containerEl).setName("Depo").addText((t) =>
      t.setValue(s.repo).onChange(async (v) => {
        s.repo = v.trim();
        await save();
      }),
    );
    new Setting(containerEl).setName("Dal").addText((t) =>
      t.setValue(s.branch).onChange(async (v) => {
        s.branch = v.trim() || "main";
        await save();
      }),
    );

    new Setting(containerEl)
      .setName("Otomatik senkron aralığı (dakika)")
      .setDesc("0 = kapalı. Bot yeni notları GitHub'a yazdıkça buradan çekilir.")
      .addText((t) =>
        t.setValue(String(s.intervalMinutes)).onChange(async (v) => {
          const n = Number(v);
          s.intervalMinutes = Number.isFinite(n) && n >= 0 ? n : 0;
          await save();
          this.plugin.setupTimer();
        }),
      );

    new Setting(containerEl).setName("Açılışta senkronla").addToggle((t) =>
      t.setValue(s.syncOnStartup).onChange(async (v) => {
        s.syncOnStartup = v;
        await save();
      }),
    );
    new Setting(containerEl)
      .setName("Değişiklikten 1 dk sonra senkronla")
      .addToggle((t) =>
        t.setValue(s.syncOnChange).onChange(async (v) => {
          s.syncOnChange = v;
          await save();
        }),
      );

    new Setting(containerEl).setName("Şimdi senkronla").addButton((b) =>
      b.setButtonText("Senkronla").onClick(() => this.plugin.sync(true)),
    );
  }
}
