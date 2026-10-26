import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeLicense, encodeLicense, licenseProblem, localDay, machineCode, type License } from "../server/lib/license.js";

const seller = generateKeyPairSync("ed25519");
const issue = (license: License) => encodeLicense(license, (data) => sign(null, data, seller.privateKey));

const license: License = { name: "Nguyễn Văn A", machine: "7F3A-91C2-04BE-D5E1", expires: "2027-10-26", issued: "2026-10-26" };

describe("licence keys", () => {
  it("reads back what the seller signed", () => {
    expect(decodeLicense(issue(license), seller.publicKey)).toEqual(license);
  });

  it("survives the line breaks and spaces a chat app adds", () => {
    const key = issue(license);
    const wrapped = ` ${key.slice(0, 40)}\n${key.slice(40, 90)}\r\n  ${key.slice(90)} `;
    expect(decodeLicense(wrapped, seller.publicKey)).toEqual(license);
  });

  it("refuses a key signed by anyone else", () => {
    const other = generateKeyPairSync("ed25519");
    const forged = encodeLicense(license, (data) => sign(null, data, other.privateKey));
    expect(() => decodeLicense(forged, seller.publicKey)).toThrow(/không hợp lệ/);
  });

  it("refuses a key whose terms were changed", () => {
    const [head, signature] = issue(license).split(".");
    const longer = Buffer.from(JSON.stringify({ n: license.name, m: license.machine, e: null, i: license.issued })).toString("base64url");
    expect(head.startsWith("SS1-")).toBe(true);
    expect(() => decodeLicense(`SS1-${longer}.${signature}`, seller.publicKey)).toThrow(/không hợp lệ/);
  });

  it("refuses text that is not a key", () => {
    expect(() => decodeLicense("xin chào", seller.publicKey)).toThrow(/định dạng/);
  });
});

describe("licenseProblem", () => {
  it("accepts the machine it was made for, up to and including the last day", () => {
    expect(licenseProblem(license, license.machine, "2026-11-01")).toBeNull();
    expect(licenseProblem(license, license.machine, "2027-10-26")).toBeNull();
  });

  it("stops the day after it expires", () => {
    expect(licenseProblem(license, license.machine, "2027-10-27")).toMatch(/hết hạn từ ngày 26\/10\/2027/);
  });

  it("never expires without an end date", () => {
    expect(licenseProblem({ ...license, expires: null }, license.machine, "2099-01-01")).toBeNull();
  });

  it("refuses another machine", () => {
    expect(licenseProblem(license, "0000-0000-0000-0000", "2026-11-01")).toMatch(/dành cho máy 7F3A-91C2-04BE-D5E1/);
  });
});

describe("machineCode", () => {
  it("is four groups of hex digits, the same every time", () => {
    expect(machineCode()).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(machineCode()).toBe(machineCode());
  });
});

describe("localDay", () => {
  it("is the date on this machine's clock", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
