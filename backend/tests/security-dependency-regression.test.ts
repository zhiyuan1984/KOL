import { deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
import AdmZip from "adm-zip";
import { Address4, Address6 } from "ip-address";
import { describe, expect, it } from "vitest";
import { validatePptx } from "../src/knowledge/pptx.js";
import { RemoteMcpClient } from "../src/mcp/remote.js";

const require = createRequire(import.meta.url);
const fastUri = require("fast-uri") as { serialize(value: Record<string, string>): string };
const proxyaddr = require("proxy-addr") as {
  compile(trust: string[]): (address: string) => boolean;
};

type ZipEntry = {
  name: string;
  data: string | Buffer;
  method?: 0 | 8;
  declaredSize?: number;
};

function crc32(data: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** Build a minimal, in-memory ZIP so the security fixtures never extract files. */
function zip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(raw) : raw;
    const size = entry.declaredSize ?? raw.length;
    const crc = crc32(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x0403_4b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x0201_4b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(localOffset, 42);
    local.push(header, name, compressed);
    central.push(directory, name);
    localOffset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...local, directory, end]);
}

function pptxEntries(options: {
  entity?: boolean;
  externalMedia?: boolean;
  duplicateSlide?: boolean;
  declaredSlideSize?: number;
  fillerEntries?: number;
} = {}): ZipEntry[] {
  const contentTypes = `${options.entity ? "<!DOCTYPE Types [<!ENTITY xxe SYSTEM 'file:///never-read'>]>" : ""}<Types>application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml</Types>`;
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "ppt/presentation.xml", data: '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>' },
    { name: "ppt/_rels/presentation.xml.rels", data: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>' },
    { name: "ppt/slides/slide1.xml", data: "<p:sld xmlns:p=\"p\"/>", method: options.declaredSlideSize == null ? 0 : 8, declaredSize: options.declaredSlideSize },
  ];
  if (options.externalMedia) entries.push({ name: "ppt/slides/_rels/slide1.xml.rels", data: '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://attacker.invalid/image" TargetMode="External"/></Relationships>' });
  if (options.duplicateSlide) entries.push({ name: "ppt/slides/slide1.xml", data: "<p:sld xmlns:p=\"p\"/>" });
  for (let i = 0; i < (options.fillerEntries ?? 0); i += 1) entries.push({ name: `ppt/media/filler-${i}.bin`, data: "" });
  return entries;
}

function expectInvalidPptx(bytes: Buffer): void {
  expect(() => validatePptx(bytes)).toThrow();
}

describe("dependency security regressions", () => {
  it("enforces adm-zip 0.6.1 declared-size limits for both sync and async in-memory reads", async () => {
    const bytes = zip([{ name: "payload.txt", data: "more-than-one-byte", method: 8, declaredSize: 0 }]);
    const entry = new AdmZip(bytes).getEntry("payload.txt");
    expect(entry).toBeTruthy();
    expect(() => entry!.getData()).toThrow(/larger than 1 bytes/);
    await new Promise<void>((resolve, reject) => entry!.getDataAsync((data, error) => {
      try {
        expect(data).toHaveLength(0);
        expect(error).toBeTruthy();
        resolve();
      } catch (assertion) {
        reject(assertion);
      }
    }));
  });

  it("validates PPTX buffers without extraction and rejects corrupt, oversized, duplicate, XML and external-media inputs", () => {
    expect(validatePptx(zip(pptxEntries()))).toBe(1);
    expectInvalidPptx(Buffer.from("not a zip"));
    expectInvalidPptx(zip(pptxEntries({ declaredSlideSize: 0 })));
    expectInvalidPptx(zip(pptxEntries({ duplicateSlide: true })));
    expectInvalidPptx(zip(pptxEntries({ entity: true })));
    expectInvalidPptx(zip(pptxEntries({ externalMedia: true })));
    expectInvalidPptx(zip(pptxEntries({ fillerEntries: 20_001 })));
  });

  it("keeps URI authority, address-family and mapped-subnet trust boundaries intact", () => {
    expect(fastUri.serialize({ scheme: "https", host: "trusted.example@evil.example", path: "/" })).toBe("https://trusted.example%40evil.example/");
    const ipv4 = new Address4("192.0.2.7");
    const ipv6 = new Address6("2001:db8::7");
    expect(ipv4.isInSubnet(ipv6)).toBe(false);
    expect(ipv6.isInSubnet(ipv4)).toBe(false);
    expect(proxyaddr.compile(["::ffff:10.0.0.0/8"])("203.0.113.7")).toBe(false);
    expect(proxyaddr.compile(["::ffff:10.0.0.0/104"])("10.0.0.7")).toBe(true);
  });

  it("does not treat inherited prototype values as MCP authentication headers", () => {
    const inheritedHeaders = Object.create({ authorization: "Bearer inherited-untrusted-value" }) as Record<string, string>;
    expect(() => new RemoteMcpClient({ url: "https://mcp.example.test/mcp", headers: inheritedHeaders })).toThrow("MCP auth header is required");
  });
});
