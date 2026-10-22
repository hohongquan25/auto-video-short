import { describe, expect, it } from "vitest";
import { fileSlug, formatPlan, storyNameFromTitle, videoFileName, type Job, type PublishKit } from "../server/types.js";

describe("formatPlan", () => {
  it("renders the chosen formats in a fixed order", () => {
    expect(formatPlan(["original", "tiktok"]).map((p) => p.format)).toEqual(["tiktok", "original"]);
  });

  it("gives YouTube one long video only when TikTok is chosen too", () => {
    expect(formatPlan(["youtube", "tiktok"])).toEqual([
      { format: "tiktok", whole: false },
      { format: "youtube", whole: true },
    ]);
    expect(formatPlan(["youtube"])).toEqual([{ format: "youtube", whole: false }]);
    expect(formatPlan(["youtube", "original"]).every((p) => !p.whole)).toBe(true);
  });
});

describe("file names", () => {
  const part = { index: 1, file: "", textFile: "", durationSec: 1 };
  const job = (title: string, outputs: Partial<Job["outputs"][number]>[], storyName?: string) =>
    ({ title, outputs: outputs.map((o) => ({ parts: [], fullVideo: null, ...o })), publish: storyName ? { storyName } as PublishKit : null }) as unknown as Job;

  it("drops Vietnamese marks and joins words with _", () => {
    expect(fileSlug("Ba Tiếng Gõ Cửa!")).toBe("ba_tieng_go_cua");
    expect(fileSlug("[FULL] MẸ BẠN “CÔNG CHÚA” - ĐÊM 2")).toBe("full_me_ban_cong_chua_dem_2");
  });

  it("names parts, the uncut story and a story never cut", () => {
    const one = job("Ba Tiếng Gõ Cửa", [{ format: "tiktok", parts: [part], fullVideo: part }]);
    expect(videoFileName(one, "tiktok", 2)).toBe("ba_tieng_go_cua_phan_2");
    expect(videoFileName(one, "tiktok", null)).toBe("ba_tieng_go_cua_day_du");
    expect(videoFileName(job("Ba Tiếng Gõ Cửa", [{ format: "youtube", fullVideo: part }]), "youtube", null)).toBe("ba_tieng_go_cua");
  });

  it("names the format only when the job has several", () => {
    const two = job("Ba Tiếng Gõ Cửa", [{ format: "tiktok", parts: [part] }, { format: "youtube", fullVideo: part }]);
    expect(videoFileName(two, "tiktok", 1)).toBe("ba_tieng_go_cua_tiktok_phan_1");
    expect(videoFileName(two, "youtube", null)).toBe("ba_tieng_go_cua_youtube");
  });

  it("keeps only the story's name out of a source video's title", () => {
    expect(storyNameFromTitle("2 phút - Người đàn ông và quả dừa - Bài học về sự kiên nhẫn - Truyện ngắn trẻ em")).toBe("Người đàn ông và quả dừa");
    expect(storyNameFromTitle("[FULL] MẸ BẠN CÙNG PHÒNG CHĂM SÓC “CÔNG CHÚA” - SHABI AUDIO")).toBe("MẸ BẠN CÙNG PHÒNG CHĂM SÓC CÔNG CHÚA");
    expect(storyNameFromTitle("[TRUYỆN KINH DỊ] || BÁT TỰ LẤY MẠNG || ÂM NHÃN AUDIO")).toBe("BÁT TỰ LẤY MẠNG");
    expect(storyNameFromTitle("216K views · 3K reactions | Tôi huấn luyện chó nghiệp vụ. Suốt 9 năm, nó chưa từng sai")).toBe("Tôi huấn luyện chó nghiệp vụ");
    expect(storyNameFromTitle("Phần 1 || BẬT MODE MỎ HỖN Cre: Hắc Miêu Audio #ngontinh")).toBe("BẬT MODE MỎ HỖN");
    expect(storyNameFromTitle("TRUYỆN MA: Ngôi nhà số 9")).toBe("Ngôi nhà số 9");
    expect(storyNameFromTitle("3. Vụ Mất Tích Trên Chuyến Xe Đêm")).toBe("Vụ Mất Tích Trên Chuyến Xe Đêm");
    // Words that only look like noise stay.
    expect(storyNameFromTitle("Bí mật con kênh đào - Truyện ma có thật")).toBe("Bí mật con kênh đào");
    expect(storyNameFromTitle("Lời nguyền 9:00 tối")).toBe("Lời nguyền 9:00 tối");
    expect(storyNameFromTitle("Ba Tiếng Gõ Cửa")).toBe("Ba Tiếng Gõ Cửa");
  });

  it("names files after the AI's short name when there is one, else the cleaned title", () => {
    const outputs = [{ format: "tiktok" as const, parts: [part] }];
    expect(videoFileName(job("[FULL] Bát Tự Lấy Mạng - Âm Nhãn Audio", outputs, "Bát tự lấy mạng"), "tiktok", 1)).toBe("bat_tu_lay_mang_phan_1");
    expect(videoFileName(job("[FULL] Bát Tự Lấy Mạng - Âm Nhãn Audio", outputs), "tiktok", 1)).toBe("bat_tu_lay_mang_phan_1");
  });

  it("cuts a long title and falls back when nothing is left", () => {
    const long = videoFileName(job("Truyện ".repeat(30), [{ format: "tiktok", parts: [part] }]), "tiktok", 1);
    expect(long).toMatch(/^(truyen_)+truyen_phan_1$/);
    expect(long.length).toBeLessThanOrEqual(80 + "_phan_1".length);
    expect(videoFileName(job("!!!", [{ format: "tiktok", parts: [part] }]), "tiktok", 1)).toBe("video_phan_1");
  });
});
