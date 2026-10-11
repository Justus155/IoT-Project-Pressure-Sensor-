// firmware/simulator.js
// Simulates an ESP32 pushing data to Supabase, for demos without hardware.
// Uses the same device RPCs as the firmware (sql/device_api.sql).
//
// Usage — open any AquaGuard page (config.js must be loaded), paste this
// file into the browser console, then:
//   await aquaguardSim.init('S-01', '482913');  // sensor_id + pairing code
//   aquaguardSim.start();                        // upload every 10 s
//   aquaguardSim.triggerLeak();                  // pressure drops, LEAK alert
//   aquaguardSim.triggerOverflow();              // pressure spikes, OVERFLOW alert
//   aquaguardSim.reset();                        // back to normal, clears alerts
//   aquaguardSim.stop();

(() => {
  const client = window.createAquaGuardClient();
  if (!client) return;

  const UPLOAD_INTERVAL_MS = 10000;

  window.aquaguardSim = {
    interval: null,
    sensorId: null,
    deviceCode: null,
    range: { min: 0, max: 100 },
    baseline: 45,
    currentPSI: 45,
    leakActive: false,
    overflowActive: false,

    async init(sensorId = 'S-01', deviceCode = '482913') {
      this.stop();
      this.sensorId = sensorId;
      this.deviceCode = deviceCode;

      const { data, error } = await client.rpc('device_get_thresholds', this._auth());
      if (error) {
        console.error('Device not found or wrong code. Run synthetic_data.sql and device_api.sql first.', error);
        this.sensorId = null;
        return false;
      }

      const leakT = (data || []).find((t) => t.parameter === 'LEAK_THRESHOLD');
      const overflowT = (data || []).find((t) => t.parameter === 'OVERFLOW_THRESHOLD');
      this.range = {
        min: Number(leakT?.min_value ?? 0),
        max: Number(overflowT?.max_value ?? 100)
      };
      this.baseline = this.range.min + (this.range.max - this.range.min) * 0.45;
      this.currentPSI = this.baseline;

      console.log(`✅ Simulator ready for ${sensorId} — range ${this.range.min}–${this.range.max} PSI`);
      return true;
    },

    start() {
      if (!this._ready()) return;
      this.stop();
      this.tick();
      this.interval = setInterval(() => this.tick(), UPLOAD_INTERVAL_MS);
      console.log(`▶️ Uploading every ${UPLOAD_INTERVAL_MS / 1000} s`);
    },

    stop() {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
        console.log('⏹️ Stopped');
      }
    },

    async tick() {
      const span = this.range.max - this.range.min;
      let target = this.baseline;
      if (this.leakActive) target = this.range.min + span * 0.1;
      if (this.overflowActive) target = this.range.min + span * 0.95;

      // Ease toward the target with a little noise, like a real pipe.
      this.currentPSI += (target - this.currentPSI) * 0.5 + (Math.random() - 0.5) * 2;
      this.currentPSI = Math.max(0, this.currentPSI);

      const value = Math.round(this.currentPSI * 10) / 10;
      const { error } = await client.rpc('device_insert_reading', { ...this._auth(), p_value: value });
      if (error) console.error('Reading upload failed:', error.message);
      else console.log(`📤 ${value} PSI`);
    },

    async triggerLeak() {
      if (!this._ready()) return;
      this.leakActive = true;
      this.overflowActive = false;
      await this._raise('LEAK');
    },

    async triggerOverflow() {
      if (!this._ready()) return;
      this.overflowActive = true;
      this.leakActive = false;
      await this._raise('OVERFLOW');
    },

    async reset() {
      if (!this._ready()) return;
      this.leakActive = false;
      this.overflowActive = false;
      for (const type of ['LEAK', 'OVERFLOW']) {
        const { error } = await client.rpc('device_clear_alert', { ...this._auth(), p_type: type });
        if (error) console.error(`Clearing ${type} failed:`, error.message);
      }
      console.log('✅ Alerts cleared, pressure returning to baseline');
    },

    async _raise(type) {
      const { error } = await client.rpc('device_raise_alert', { ...this._auth(), p_type: type });
      if (error) console.error(`${type} alert failed:`, error.message);
      else console.log(`🚨 ${type} alert raised`);
    },

    _auth() {
      return { p_sensor_id: this.sensorId, p_device_code: this.deviceCode };
    },

    _ready() {
      if (!this.sensorId) {
        console.error('Call await aquaguardSim.init(sensorId, deviceCode) first.');
        return false;
      }
      return true;
    }
  };

  console.log('AquaGuard simulator loaded — run: await aquaguardSim.init("S-01", "482913")');
})();
