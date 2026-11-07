import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDonor } from "@/server/registration/register-donor";
import { registerVolunteer } from "@/server/registration/register-volunteer";
import { POST as donorPost } from "./donor/route";
import { POST as volunteerPost } from "./volunteer/route";

vi.mock("@/server/registration/register-donor", () => ({ registerDonor: vi.fn() }));
vi.mock("@/server/registration/register-volunteer", () => ({ registerVolunteer: vi.fn() }));
vi.mock("@/server/registration/prisma-registration-store", () => ({ prismaRegistrationStore: {} }));
vi.mock("@/server/storage", () => ({ createServerStorage: vi.fn(() => ({})) }));

const proofBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const addressJson = JSON.stringify({
  streetLine1: "123 Katipunan Ave",
  city: "Quezon City",
  latitude: 14.676,
  longitude: 121.0437,
});

// A fresh body per request, so no iteration depends on an earlier one.
function signupForm(kind: "donor" | "volunteer"): FormData {
  const fd = new FormData();
  if (kind === "donor") fd.set("donorType", "INDIVIDUAL");
  fd.set("fullName", "Test Person");
  fd.set("contactNumber", "09171234567");
  fd.set("email", `${kind}@example.com`);
  fd.set("address", addressJson);
  fd.set("password", "Abcdef1!");
  fd.set("consent", "true");
  fd.set("proof", new File([proofBytes], "proof.jpg", { type: "image/jpeg" }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signup routes parity", () => {
  it.each([
    { error: "EMAIL_TAKEN", status: 409 },
    { error: "INVALID_PROOF", status: 400 },
  ] as const)("return identical responses for $error", async ({ error, status }) => {
    vi.mocked(registerDonor).mockResolvedValue({ ok: false, error });
    vi.mocked(registerVolunteer).mockResolvedValue({ ok: false, error });

    const donorRes = await donorPost(
      new Request("http://localhost/api/auth/register/donor", { method: "POST", body: signupForm("donor") }),
    );
    const volunteerRes = await volunteerPost(
      new Request("http://localhost/api/auth/register/volunteer", { method: "POST", body: signupForm("volunteer") }),
    );

    expect(donorRes.status).toBe(status);
    expect(volunteerRes.status).toBe(status);
    expect(await volunteerRes.text()).toBe(await donorRes.text());
  });
});