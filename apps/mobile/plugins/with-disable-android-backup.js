const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withDisableAndroidBackup(config) {
  return withAndroidManifest(config, (nextConfig) => {
    const application = nextConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("Android application manifest entry was not generated.");
    }

    application.$ = application.$ || {};
    application.$["android:allowBackup"] = "false";

    // These rules are unnecessary when backup is disabled and leaving them in
    // place makes it easy to accidentally re-enable restoration of encrypted
    // SQLite files without their device-bound Secure Store key.
    delete application.$["android:fullBackupContent"];
    delete application.$["android:dataExtractionRules"];

    return nextConfig;
  });
};
