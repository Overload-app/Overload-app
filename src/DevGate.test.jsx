// @vitest-environment jsdom
//
// Real ask: visitors see "under development, available soon"; only testers
// with the password get in. The REAL password must never appear in this repo,
// so every test here uses a made-up one and passes in its hash.
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevGate, sha256Hex, TESTER_PASSWORD_HASH, TESTERS } from "./DevGate.jsx";

const TEST_PASSWORD = "correct-horse-test";
const TEST_HASH = "efeedfae30aad25f0ad201923046c51e40a65030cdb4b85603897d6cdc2c7c38";

function renderGate(props = {}) {
  return render(
    <DevGate enabled passwordHash={TEST_HASH} {...props}>
      <div>THE REAL APP</div>
    </DevGate>
  );
}

describe("<DevGate />", () => {
  beforeEach(() => { try { localStorage.clear(); } catch (e) {} });

  test("a visitor sees the under-development message, not the app", () => {
    renderGate();
    expect(screen.getByText("This site is under development and will be available soon.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your tester password")).toBeInTheDocument();
    expect(screen.queryByText("THE REAL APP")).not.toBeInTheDocument();
  });

  test("the wrong password is refused and the app stays hidden", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.type(screen.getByLabelText("Your tester password"), "guess");
    await user.click(screen.getByText("Enter"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick which tester you are first.");
    expect(screen.queryByText("THE REAL APP")).not.toBeInTheDocument();
  });

  test("the right password lets a tester in", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.type(screen.getByLabelText("Your tester password"), TEST_PASSWORD);
    await user.click(screen.getByText("Enter"));
    expect(await screen.findByText("THE REAL APP")).toBeInTheDocument();
  });

  test("it's case-sensitive", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.type(screen.getByLabelText("Your tester password"), TEST_PASSWORD.toUpperCase());
    await user.click(screen.getByText("Enter"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  test("a trailing space from a phone keyboard doesn't lock a tester out", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.type(screen.getByLabelText("Your tester password"), TEST_PASSWORD + " ");
    await user.click(screen.getByText("Enter"));
    expect(await screen.findByText("THE REAL APP")).toBeInTheDocument();
  });

  test("once unlocked, a tester isn't asked again on this device", async () => {
    const user = userEvent.setup();
    const { unmount } = renderGate();
    await user.type(screen.getByLabelText("Your tester password"), TEST_PASSWORD);
    await user.click(screen.getByText("Enter"));
    await screen.findByText("THE REAL APP");
    unmount();
    renderGate();
    expect(screen.getByText("THE REAL APP")).toBeInTheDocument();
  });

  test("turning it off at launch shows the app to everyone", () => {
    renderGate({ enabled: false });
    expect(screen.getByText("THE REAL APP")).toBeInTheDocument();
  });

  test("the hash function matches standard SHA-256", async () => {
    expect(await sha256Hex(TEST_PASSWORD)).toBe(TEST_HASH);
  });

  test("the shipped hash is a real SHA-256 hash, not a plaintext password", () => {
    expect(TESTER_PASSWORD_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("tester passwords", () => {
    let fetchSpy;
    afterEach(() => fetchSpy?.mockRestore());
    const answer = (status, body) => { fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: status === 200, status, json: async () => body }); };

    test("lists 15 testers", () => {
      renderGate();
      expect(TESTERS.length).toBe(15);
      expect(screen.getAllByRole("option").length).toBe(16);
    });

    test("a tester's own password lets them in, and the server gets this device's id", async () => {
      answer(200, { ok: true, locked: true });
      const user = userEvent.setup();
      renderGate();
      await user.selectOptions(screen.getByLabelText("Testers: who are you?"), "7");
      await user.type(screen.getByLabelText("Your tester password"), "maple-raven-42 ");
      await user.click(screen.getByText("Enter"));
      expect(await screen.findByText("THE REAL APP")).toBeInTheDocument();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body).toMatchObject({ tester: 7, password: "maple-raven-42" });
      expect(typeof body.deviceId).toBe("string");
      // Same id next time, so this device stays recognised.
      expect(localStorage.getItem("overload_device_id")).toBe(body.deviceId);
    });

    test("a password already used on another device is refused with the server's reason", async () => {
      answer(403, { error: "This tester password is already being used on another device." });
      const user = userEvent.setup();
      renderGate();
      await user.selectOptions(screen.getByLabelText("Testers: who are you?"), "2");
      await user.type(screen.getByLabelText("Your tester password"), "x");
      await user.click(screen.getByText("Enter"));
      expect(await screen.findByRole("alert")).toHaveTextContent("already being used on another device");
      expect(screen.queryByText("THE REAL APP")).not.toBeInTheDocument();
    });

    test("no connection says so, instead of 'wrong password'", async () => {
      fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
      const user = userEvent.setup();
      renderGate();
      await user.selectOptions(screen.getByLabelText("Testers: who are you?"), "3");
      await user.type(screen.getByLabelText("Your tester password"), "x");
      await user.click(screen.getByText("Enter"));
      expect(await screen.findByRole("alert")).toHaveTextContent(/connection/);
    });

    test("the owner's password still works without picking a tester or asking the server", async () => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
      const user = userEvent.setup();
      renderGate();
      await user.type(screen.getByLabelText("Your tester password"), TEST_PASSWORD);
      await user.click(screen.getByText("Enter"));
      expect(await screen.findByText("THE REAL APP")).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
