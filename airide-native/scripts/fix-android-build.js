const fs = require('fs');
const path = require('path');

const nodeModules = path.join(__dirname, '..', 'node_modules');

function patchFile(relativePath, replacements) {
    const filePath = path.join(nodeModules, relativePath);
    if (!fs.existsSync(filePath)) {
        console.warn(`[WARN] File not found: ${relativePath}`);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    replacements.forEach(({ search, replace, description }) => {
        if (content.match(search)) {
            content = content.replace(search, replace);
            modified = true;
            // console.log(`  Applied: ${description}`);
        }
    });

    if (modified) {
        fs.writeFileSync(filePath, content);
        console.log(`[FIXED] ${relativePath}`);
    } else {
        // console.log(`[OK] ${relativePath} (already patched or not matching)`);
    }
}

console.log('--- Applying Android Build Fixes (Kotlin 2.1.20 Support) ---');

// 1. Fix Internal Gradle API Usage (Gradle 8.8+ Compatibility)
// Replaces `org.gradle.internal.extensions.core.extra` with `org.gradle.api.plugins.ExtraPropertiesExtension`

const extraImportRegex = /import org\.gradle\.internal\.extensions\.core\.extra/g;
const extraImportFix = 'import org.gradle.api.plugins.ExtraPropertiesExtension';

patchFile('expo/node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-settings-plugin/src/main/kotlin/expo/modules/plugin/SettingsManager.kt', [
    { search: extraImportRegex, replace: extraImportFix, description: 'Fix internal extra import' },
    { search: /project\.extra\.set/g, replace: '(project.extensions.getByName("ext") as ExtraPropertiesExtension).set', description: 'Fix project.extra.set' },
    { search: /settings\.gradle\.extensions\.create/g, replace: 'settings.gradle.getExtensions().create', description: 'Fix extensions.create' }
]);

patchFile('expo/node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin/src/main/kotlin/expo/modules/plugin/ExpoRootProjectPlugin.kt', [
    { search: extraImportRegex, replace: extraImportFix, description: 'Fix internal extra import' },
    { search: /extra\.setIfNotExist/g, replace: 'extensions.getByType(ExtraPropertiesExtension::class.java).setIfNotExist', description: 'Fix extra.setIfNotExist' },
    { search: /extra\.get/g, replace: 'extensions.getByType(ExtraPropertiesExtension::class.java).get', description: 'Fix extra.get' },
    { search: /extra\[/g, replace: 'extensions.getByType(ExtraPropertiesExtension::class.java)[', description: 'Fix extra[] access' }
]);

patchFile('expo-modules-core/expo-module-gradle-plugin/src/main/kotlin/expo/modules/plugin/ExpoModulesGradlePlugin.kt', [
    { search: extraImportRegex, replace: extraImportFix, description: 'Fix internal extra import' },
    { search: /project\.rootProject\.extra\.safeGet/g, replace: 'project.rootProject.extensions.getByType(ExtraPropertiesExtension::class.java).safeGet', description: 'Fix rootProject.extra.safeGet' }
]);

patchFile('expo-modules-core/expo-module-gradle-plugin/src/main/kotlin/expo/modules/plugin/ProjectConfiguration.kt', [
    { search: extraImportRegex, replace: extraImportFix, description: 'Fix internal extra import' },
    { search: /extra\.set/g, replace: 'extensions.getByType(ExtraPropertiesExtension::class.java).set', description: 'Fix extra.set' },
    { search: /rootProject\.extra\.safeGet/g, replace: 'rootProject.extensions.getByType(ExtraPropertiesExtension::class.java).safeGet', description: 'Fix rootProject.extra.safeGet' }
]);

patchFile('expo-modules-core/expo-module-gradle-plugin/src/main/kotlin/expo/modules/plugin/gradle/ExpoModuleExtension.kt', [
    { search: extraImportRegex, replace: extraImportFix, description: 'Fix internal extra import' },
    { search: /project\.rootProject\.extra\.safeGet/g, replace: 'project.rootProject.extensions.getByType(ExtraPropertiesExtension::class.java).safeGet', description: 'Fix rootProject.extra.safeGet' }
]);

// 2. KSP Lookup for Kotlin 2.1.20
patchFile('expo/node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin/src/main/kotlin/expo/modules/plugin/KSPLookup.kt', [
    { 
        search: /"2\.0\.0" to "2\.0\.0-1\.0\.24"\s*\)/g, 
        replace: '"2.0.0" to "2.0.0-1.0.24",\n  "2.1.20" to "2.1.20-1.0.29"\n)', 
        description: 'Add Kotlin 2.1.20 to KSPLookup' 
    }
]);

// 3. REVERT: Enable Kotlin 2.1.20 + Compose Plugin (Undo previous downgrades if present)

const kotlin1924Regex = /kotlin\("jvm"\) version "1\.9\.24"/g;
const kotlin2120Fix = 'kotlin("jvm") version "2.1.20"';

const kotlinBuildFiles = [
    'expo-dev-launcher/expo-dev-launcher-gradle-plugin/build.gradle.kts',
    'expo-modules-core/expo-module-gradle-plugin/build.gradle.kts',
    'expo/node_modules/expo-modules-autolinking/android/expo-gradle-plugin/build.gradle.kts'
];

kotlinBuildFiles.forEach(file => {
    patchFile(file, [{ search: kotlin1924Regex, replace: kotlin2120Fix, description: 'Restore Kotlin 2.1.20' }]);
});

patchFile('@react-native/gradle-plugin/gradle/libs.versions.toml', [
    { search: /kotlin = "1\.9\.24"/g, replace: 'kotlin = "2.1.20"', description: 'Restore Kotlin 2.1.20 in toml' }
]);

// 4. REVERT: Re-enable Compose Plugin (Undo previous disable)
const disabledComposeClasspath = /\/\/ classpath\("org\.jetbrains\.kotlin\.plugin\.compose:org\.jetbrains\.kotlin\.plugin\.compose\.gradle\.plugin:\$\{kotlinVersion\}"\)/g;
const enabledComposeClasspath = 'classpath("org.jetbrains.kotlin.plugin.compose:org.jetbrains.kotlin.plugin.compose.gradle.plugin:${kotlinVersion}")';

const disabledComposePlugin = /\/\/ apply plugin: 'org\.jetbrains\.kotlin\.plugin\.compose'/g;
const enabledComposePlugin = "apply plugin: 'org.jetbrains.kotlin.plugin.compose'";

const legacyComposeBlock = /buildFeatures \{\s*([\w\s]+)\s*compose true\s*\}\s*composeOptions \{\s*kotlinCompilerExtensionVersion = "1.5.14"\s*\}/g;

// Helper to clean up the legacy block we added
// This is tricky with regex, simpler approach: replace the whole block we know we added.
// We added:
// buildFeatures {
//    ...
//    compose true
// }
//
// composeOptions {
//   kotlinCompilerExtensionVersion = "1.5.14"
// }

// expo-dev-launcher
patchFile('expo-dev-launcher/android/build.gradle', [
    { search: disabledComposeClasspath, replace: enabledComposeClasspath, description: 'Re-enable Compose classpath' },
    { search: disabledComposePlugin, replace: enabledComposePlugin, description: 'Re-enable Compose plugin' },
    { 
        search: /kotlinCompilerExtensionVersion = "1\.5\.14"/g, 
        replace: '// kotlinCompilerExtensionVersion = "1.5.14" // Reverted by fix script', 
        description: 'Disable legacy composeOptions' 
    },
    {
        search: /compose true/g,
        replace: '// compose true // Reverted',
        description: 'Disable legacy buildFeature compose'
    }
]);

// expo-dev-menu
patchFile('expo-dev-menu/android/build.gradle', [
    { search: disabledComposeClasspath, replace: enabledComposeClasspath, description: 'Re-enable Compose classpath' },
    { search: disabledComposePlugin, replace: enabledComposePlugin, description: 'Re-enable Compose plugin' },
    { 
        search: /kotlinCompilerExtensionVersion = "1\.5\.14"/g, 
        replace: '// kotlinCompilerExtensionVersion = "1.5.14" // Reverted by fix script', 
        description: 'Disable legacy composeOptions' 
    },
     {
        // expo-dev-menu ALREADY had compose true, so we shouldn't strictly comment it out 
        // unless we want to rely entirely on the plugin. 
        // But the plugin usually sets it up?
        // Actually, for Kotlin 2.0+ Compose plugin, you still need valid config?
        // The plugin applies the compiler. buildFeatures { compose true } is still needed for AGP.
        // So we should KEEP `compose true` but REMOVE `composeOptions { ... 1.5.14 ... }`.
        
        search: /kotlinCompilerExtensionVersion = "1\.5\.14"/g, 
        replace: '// kotlinCompilerExtensionVersion = "1.5.14" // Reverted', 
        description: 'Disable legacy composeOptions'
    }
]);


console.log('--- Fixes Applied Successfully ---');
