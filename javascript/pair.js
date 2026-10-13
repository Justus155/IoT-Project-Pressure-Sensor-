// ============================================================
// AquaGuard — Pairing helpers
// ============================================================

export async function redeemPairingCode(client, code) {
  const trimmed = String(code || "").trim();

  if (!/^[0-9]{6}$/.test(trimmed)) {
    return { ok: false, message: "Enter a 6-digit code." };
  }

  const { data, error } = await client.rpc("redeem_pairing_code", {
    p_code: trimmed,
  });

  if (error) {
    console.error("Pairing failed:", error);
    return { ok: false, message: error.message || "Could not pair device." };
  }

  return { ok: true, device: data };
}

export function wireCodeInputs(container) {
  const inputs = container.querySelectorAll(".code-digit");

  inputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^0-9]/g, "").slice(0, 1);
      input.classList.toggle("filled", input.value !== "");
      if (input.value && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0) {
        inputs[index - 1].focus();
      }
      if (event.key === "ArrowLeft" && index > 0) inputs[index - 1].focus();
      if (event.key === "ArrowRight" && index < inputs.length - 1) inputs[index + 1].focus();
    });

    input.addEventListener("paste", (event) => {
      const text = (event.clipboardData || window.clipboardData).getData("text");
      if (/^\d{6}$/.test(text)) {
        event.preventDefault();
        inputs.forEach((box, i) => {
          box.value = text[i];
          box.classList.add("filled");
        });
        inputs[inputs.length - 1].focus();
      }
    });
  });

  return {
    getValue: () => Array.from(inputs).map((i) => i.value).join(""),
    clear: () => inputs.forEach((i) => { i.value = ""; i.classList.remove("filled"); }),
    focus: () => inputs[0]?.focus(),
  };
}