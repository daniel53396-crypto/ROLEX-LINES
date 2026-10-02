async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (response.status === 401) {
    location.href = "/login.html";
    return null;
  }

  return response.json();
}

async function loadStats() {
  const data = await request("/api/stats");

  if (!data) return;

  document.getElementById("total").textContent =
    data.total;

  document.getElementById("active").textContent =
    data.active;

  document.getElementById("expired").textContent =
    data.expired;

  document.getElementById("revoked").textContent =
    data.revoked;
}

async function loadLicenses() {
  const data = await request("/api/licenses");

  if (!data) return;

  const table =
    document.getElementById("licenseTable");

  table.innerHTML = "";

  data.licenses.forEach((license) => {

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>
        <code>${license.license_key}</code>
      </td>

      <td>${escapeHtml(license.customer)}</td>

      <td>${license.type}</td>

      <td>
        ${new Date(
          license.expires_at
        ).toLocaleDateString()}
      </td>

      <td>
        ${license.activations}/${license.max_activations}
      </td>

      <td>
        <span class="status ${license.status}">
          ${license.status}
        </span>
      </td>

      <td>
        ${
          license.status === "active"
            ? `<button
                 class="danger"
                 onclick="revokeLicense(${license.id})"
               >
                 REVOKE
               </button>`
            : "-"
        }
      </td>
    `;

    table.appendChild(row);
  });
}

async function revokeLicense(id) {
  if (!confirm("Revoke this license?")) {
    return;
  }

  await request(`/api/licenses/${id}/revoke`, {
    method: "POST"
  });

  await loadStats();
  await loadLicenses();
}

document
  .getElementById("generate")
  .addEventListener("click", async () => {

    const customer =
      document.getElementById("customer").value.trim();

    const type =
      document.getElementById("type").value;

    const maxActivations =
      document.getElementById("maxActivations").value;

    if (!customer) {
      alert("Enter customer name");
      return;
    }

    const data = await request("/api/licenses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        customer,
        type,
        maxActivations
      })
    });

    if (!data || !data.success) {
      alert(data?.message || "Failed");
      return;
    }

    document.getElementById(
      "generatedKey"
    ).innerHTML = `
      <div class="key-box">
        <span>NEW LICENSE KEY</span>
        <strong>${data.license.license_key}</strong>
        <button onclick="copyKey('${data.license.license_key}')">
          COPY
        </button>
      </div>
    `;

    document.getElementById("customer").value = "";

    await loadStats();
    await loadLicenses();
  });

async function copyKey(key) {
  await navigator.clipboard.writeText(key);
  alert("License key copied");
}

document
  .getElementById("logout")
  .addEventListener("click", async () => {

    await request("/api/logout", {
      method: "POST"
    });

    location.href = "/login.html";
  });

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

(async function init() {
  const session = await request("/api/session");

  if (!session?.authenticated) {
    location.href = "/login.html";
    return;
  }

  await loadStats();
  await loadLicenses();
})();