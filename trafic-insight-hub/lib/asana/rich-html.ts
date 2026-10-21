// Descrição (Asana) com formatação: converte o html_notes do Asana pro editor da tela (e de volta).
// Só no navegador (usa DOM). Só passam as marcas que o Asana aceita; o resto vira texto puro.

const KEEP = new Set(["strong", "em", "u", "s", "code", "ol", "ul", "li", "blockquote", "pre", "h1", "h2", "a"]);
const SAFE_HREF = /^(https?:|mailto:)/i;
const ASANA_ATTR = /^data-asana-[a-z-]+$/;
const BLOCK_END = /(<\/(ul|ol|h1|h2|blockquote|pre)>|\n)$/;

// O Asana não aceita imagem solta no texto: se a descrição tem imagem, não dá pra editar com formatação por aqui.
export function hasImage(html: string | null | undefined): boolean {
  return /<img[\s>/]/i.test(html ?? "");
}

// html_notes do Asana -> HTML seguro pro editor (quebra de linha "\n" vira <br>).
export function toEditorHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const out = document.createElement("div");
  const walk = (src: Node, dst: HTMLElement) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const raw = n.textContent ?? "";
        if ((dst.tagName === "UL" || dst.tagName === "OL") && !raw.trim()) return;
        raw.split("\n").forEach((t, i) => {
          if (i > 0) dst.appendChild(document.createElement("br"));
          if (t) dst.appendChild(document.createTextNode(t));
        });
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        dst.appendChild(document.createElement("br"));
        return;
      }
      if (!KEEP.has(tag)) {
        walk(el, dst);
        return;
      }
      const c = document.createElement(tag);
      if (tag === "a") {
        const href = el.getAttribute("href") ?? "";
        if (SAFE_HREF.test(href)) {
          c.setAttribute("href", href);
          c.setAttribute("target", "_blank");
          c.setAttribute("rel", "noreferrer");
        }
        for (const a of Array.from(el.attributes)) if (ASANA_ATTR.test(a.name)) c.setAttribute(a.name, a.value);
      }
      walk(el, c);
      dst.appendChild(c);
    });
  };
  walk(doc.body, out);
  return out.innerHTML;
}

const INLINE: Record<string, string> = { b: "strong", strong: "strong", i: "em", em: "em", u: "u", s: "s", strike: "s", del: "s", code: "code" };
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Conteúdo do editor -> html_notes (quebra de linha = "\n", sem <div>/<p>).
export function fromEditor(root: HTMLElement): string {
  let out = "";
  const startBlock = () => {
    if (out && !BLOCK_END.test(out)) out += "\n";
  };
  const kids = (n: Node, depth: number) => n.childNodes.forEach((c) => walk(c, depth));
  const walk = (n: Node, depth: number) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += esc((n.textContent ?? "").replace(/ /g, " "));
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (INLINE[tag]) {
      out += `<${INLINE[tag]}>`;
      kids(el, depth);
      out += `</${INLINE[tag]}>`;
      return;
    }
    if (tag === "br") {
      out += "\n";
      return;
    }
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (!SAFE_HREF.test(href)) {
        kids(el, depth);
        return;
      }
      const extra = Array.from(el.attributes)
        .filter((a) => ASANA_ATTR.test(a.name))
        .map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`)
        .join("");
      out += `<a href="${href.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"${extra}>`;
      kids(el, depth);
      out += "</a>";
      return;
    }
    if (tag === "ul" || tag === "ol") {
      startBlock();
      out += `<${tag}>`;
      kids(el, depth + 1);
      out += `</${tag}>`;
      return;
    }
    if (tag === "li") {
      out += "<li>";
      kids(el, depth);
      out += "</li>";
      return;
    }
    if (tag === "h1" || tag === "h2" || tag === "blockquote" || tag === "pre") {
      startBlock();
      out += `<${tag}>`;
      kids(el, depth);
      out += `</${tag}>`;
      return;
    }
    if (tag === "div" || tag === "p") {
      if (depth > 0) {
        kids(el, depth);
        return;
      }
      startBlock();
      kids(el, depth);
      if (!BLOCK_END.test(out)) out += "\n";
      return;
    }
    kids(el, depth);
  };
  kids(root, 0);
  return `<body>${out.replace(/\n+$/, "")}</body>`;
}
