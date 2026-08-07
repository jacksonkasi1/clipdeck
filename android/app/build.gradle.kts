plugins {
 id("com.android.application")
 kotlin("android")
}

android {
 namespace = "app.clipdeck.desktop"
 compileSdk = 35
 defaultConfig {
 applicationId = "app.clipdeck.desktop"
 minSdk = 29
 targetSdk = 35
 versionCode = 2
 versionName = "0.1.0"
 }
 signingConfigs {
 create("release") {
 storeFile = rootProject.file("debug.keystore")
 storePassword = "android"
 keyAlias = "androiddebugkey"
 keyPassword = "android"
 }
 }
 buildTypes {
 release {
 isMinifyEnabled = true
 signingConfig = signingConfigs.getByName("release")
 proguardFiles(
 getDefaultProguardFile("proguard-android-optimize.txt"),
 "proguard-rules.pro"
 )
 }
 debug {
 signingConfig = signingConfigs.getByName("release")
 }
 }
 compileOptions {
 sourceCompatibility = JavaVersion.VERSION_17
 targetCompatibility = JavaVersion.VERSION_17
 }
 kotlinOptions { jvmTarget = "17" }
 buildFeatures { viewBinding = true }
}

dependencies {
 implementation("androidx.core:core-ktx:1.15.0")
 implementation("androidx.appcompat:appcompat:1.7.0")
 implementation("com.google.android.material:material:1.12.0")
 implementation("androidx.constraintlayout:constraintlayout:2.2.0")
 implementation("androidx.recyclerview:recyclerview:1.4.0")
 implementation("androidx.cardview:cardview:1.0.0")
 implementation("androidx.preference:preference:1.2.1")
 implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
 implementation("androidx.lifecycle:lifecycle-livedata-ktx:2.8.7")
 implementation("androidx.datastore:datastore-preferences:1.1.1")
}
