import { describe, it, expect } from "vitest";
import { parseFolderLink, shortenForDisplay } from "../folderLinks";

/* parseFolderLink is the security boundary for the linked-folder
   feature: the result.url goes straight into <a href>. Every reason
   code below maps to a real failure mode users hit OR an attack
   surface (javascript:, data:, file:). Keep these tests strict. */

describe("parseFolderLink — provider detection (valid inputs)", () => {
  it("recognizes a Drive folders URL", () => {
    const r = parseFolderLink("https://drive.google.com/drive/folders/1abc");
    expect(r.valid).toBe(true);
    expect(r.provider).toBe("google_drive");
    expect(r.label).toBe("Google Drive");
  });

  it("preserves a Drive URL with a sharing token query", () => {
    const r = parseFolderLink("https://drive.google.com/drive/folders/1abc?usp=sharing");
    expect(r.valid).toBe(true);
    expect(r.url).toBe("https://drive.google.com/drive/folders/1abc?usp=sharing");
  });

  it("recognizes a Google Docs document URL as drive", () => {
    const r = parseFolderLink("https://docs.google.com/document/d/abc/edit");
    expect(r.provider).toBe("google_drive");
  });

  it("recognizes OneDrive personal", () => {
    const r = parseFolderLink("https://onedrive.live.com/?id=ABC");
    expect(r.provider).toBe("onedrive");
  });

  it("recognizes OneDrive 1drv.ms shortener", () => {
    const r = parseFolderLink("https://1drv.ms/u/s!AbCdEf");
    expect(r.provider).toBe("onedrive");
  });

  it("recognizes corporate SharePoint subdomains", () => {
    const r = parseFolderLink("https://contoso-my.sharepoint.com/personal/jane/Documents/x");
    expect(r.provider).toBe("onedrive");
  });

  it("recognizes Dropbox", () => {
    const r = parseFolderLink("https://www.dropbox.com/sh/xyz/AAB");
    expect(r.provider).toBe("dropbox");
  });

  it("recognizes Dropbox short link", () => {
    const r = parseFolderLink("https://db.tt/xyz");
    expect(r.provider).toBe("dropbox");
  });

  it("recognizes iCloud", () => {
    const r = parseFolderLink("https://www.icloud.com/iclouddrive/abc");
    expect(r.provider).toBe("icloud");
  });

  it("falls through to 'generic' for any other valid URL", () => {
    const r = parseFolderLink("https://www.notion.so/My-Patients-abc");
    expect(r.valid).toBe(true);
    expect(r.provider).toBe("generic");
    expect(r.label).toBe("www.notion.so");
  });
});

describe("parseFolderLink — input normalization", () => {
  it("auto-prepends https:// when no scheme is present", () => {
    const r = parseFolderLink("drive.google.com/drive/folders/1abc");
    expect(r.valid).toBe(true);
    expect(r.provider).toBe("google_drive");
    expect(r.url).toMatch(/^https:\/\//);
  });

  it("upgrades http: to https:", () => {
    const r = parseFolderLink("http://drive.google.com/drive/folders/1abc");
    expect(r.valid).toBe(true);
    expect(r.url).toBe("https://drive.google.com/drive/folders/1abc");
  });

  it("strips surrounding double quotes (chat-app paste artifact)", () => {
    const r = parseFolderLink('"https://drive.google.com/drive/folders/1abc"');
    expect(r.valid).toBe(true);
    expect(r.url).toBe("https://drive.google.com/drive/folders/1abc");
  });

  it("strips surrounding single quotes", () => {
    const r = parseFolderLink("'https://drive.google.com/drive/folders/1abc'");
    expect(r.valid).toBe(true);
  });

  it("strips surrounding backticks", () => {
    const r = parseFolderLink("`https://drive.google.com/drive/folders/1abc`");
    expect(r.valid).toBe(true);
  });

  it("trims leading + trailing whitespace", () => {
    const r = parseFolderLink("   https://drive.google.com/drive/folders/1abc   ");
    expect(r.valid).toBe(true);
    expect(r.url).toBe("https://drive.google.com/drive/folders/1abc");
  });

  it("strips quotes AND whitespace combined", () => {
    const r = parseFolderLink('  "https://drive.google.com/drive/folders/1abc"  ');
    expect(r.valid).toBe(true);
  });

  it("lowercases the host", () => {
    const r = parseFolderLink("https://Drive.Google.Com/drive/folders/1abc");
    expect(r.host).toBe("drive.google.com");
    expect(r.provider).toBe("google_drive");
  });
});

describe("parseFolderLink — rejected inputs (security boundary)", () => {
  it("rejects javascript: scheme as bad_scheme", () => {
    const r = parseFolderLink("javascript:alert(1)");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("bad_scheme");
  });

  it("rejects data: URIs", () => {
    const r = parseFolderLink("data:text/html,<script>alert(1)</script>");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("bad_scheme");
  });

  it("rejects file: URIs", () => {
    const r = parseFolderLink("file:///etc/passwd");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("bad_scheme");
  });

  it("rejects mailto:", () => {
    const r = parseFolderLink("mailto:user@example.com");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("bad_scheme");
  });

  it("rejects garbled non-URL input as bad_url", () => {
    const r = parseFolderLink("not a url at all");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("bad_url");
  });

  it("rejects bare scheme with no host", () => {
    const r = parseFolderLink("https://");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("bad_url");
  });

  it("rejects empty string as empty", () => {
    expect(parseFolderLink("").reason).toBe("empty");
  });

  it("rejects only-whitespace as empty", () => {
    expect(parseFolderLink("   \n\t  ").reason).toBe("empty");
  });

  it("rejects matched empty quotes as empty", () => {
    expect(parseFolderLink('""').reason).toBe("empty");
    expect(parseFolderLink("''").reason).toBe("empty");
  });

  it("rejects null / undefined / non-string as empty", () => {
    expect(parseFolderLink(null).reason).toBe("empty");
    expect(parseFolderLink(undefined).reason).toBe("empty");
    expect(parseFolderLink(42).reason).toBe("empty");
    expect(parseFolderLink({}).reason).toBe("empty");
  });

  it("rejects > 2048 chars as too_long", () => {
    const longTail = "a".repeat(2050);
    const r = parseFolderLink(`https://drive.google.com/${longTail}`);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("too_long");
  });

  it("accepts exactly 2048 chars at the boundary", () => {
    const padding = 2048 - "https://drive.google.com/".length;
    const url = `https://drive.google.com/${"a".repeat(padding)}`;
    expect(url.length).toBe(2048);
    const r = parseFolderLink(url);
    expect(r.valid).toBe(true);
  });
});

describe("shortenForDisplay", () => {
  it("returns host + first path segment for short URLs", () => {
    expect(shortenForDisplay("https://drive.google.com/folders/1abc"))
      .toBe("drive.google.com/folders/…");
  });

  it("returns just the host when there's no path", () => {
    expect(shortenForDisplay("https://drive.google.com/")).toBe("drive.google.com");
  });

  it("ellipsizes when display would exceed max", () => {
    const short = shortenForDisplay("https://verylonghost-1234567890.example.com/path/a/b", 20);
    expect(short.length).toBeLessThanOrEqual(20);
    expect(short.endsWith("…")).toBe(true);
  });

  it("falls back to the raw input on parse failure", () => {
    expect(shortenForDisplay("not a url")).toBe("not a url");
  });

  it("returns empty string for null/undefined/empty input", () => {
    expect(shortenForDisplay(null)).toBe("");
    expect(shortenForDisplay(undefined)).toBe("");
    expect(shortenForDisplay("")).toBe("");
  });
});
