const { withAppBuildGradle } = require("expo/config-plugins");

const marker = "// Runtime libraries required by expo-sqlite when SQLCipher is enabled.";
const gradleSetup = `
${marker}
configurations {
    opensslJni
}

def openSslJniOutput = layout.buildDirectory.dir("generated/opensslJniLibs")
def extractOpenSslJniLibs = tasks.register("extractOpenSslJniLibs", Sync) {
    from({ configurations.opensslJni.collect { zipTree(it) } }) {
        include "prefab/modules/crypto/libs/android.*/libcrypto.so"
        include "prefab/modules/ssl/libs/android.*/libssl.so"
        eachFile { details ->
            def segments = details.path.split("/")
            details.path = "\${segments[4].substring("android.".length())}/\${segments[5]}"
        }
        includeEmptyDirs = false
    }
    into openSslJniOutput
}

android.sourceSets.main.jniLibs.srcDir(openSslJniOutput)
tasks.named("preBuild").configure { dependsOn(extractOpenSslJniLibs) }
`;

const dependencies = `    opensslJni("io.github.ronickg:openssl:3.3.2-1")
    implementation("io.github.ronickg:openssl:3.3.2-1")`;

module.exports = function withOpenSslAndroid(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    if (nextConfig.modResults.language !== "groovy") {
      throw new Error("The OpenSSL Android plugin requires a Groovy app build file.");
    }

    let contents = nextConfig.modResults.contents;
    if (!contents.includes(marker)) {
      contents = contents.replace(/\ndependencies\s*\{/, `${gradleSetup}\ndependencies {`);
    }
    if (!contents.includes('opensslJni("io.github.ronickg:openssl:3.3.2-1")')) {
      contents = contents.replace(/dependencies\s*\{/, (match) => `${match}\n${dependencies}`);
    }
    nextConfig.modResults.contents = contents;
    return nextConfig;
  });
};