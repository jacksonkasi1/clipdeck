pluginManagement {
 repositories {
 google { mavenCentral() }
 mavenCentral()
 gradlePluginPortal()
 }
}
dependencyResolutionManagement {
 repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
 repositories {
 google { mavenCentral() }
 mavenCentral() }
}
rootProject.name = "clipmo"
include(":app")
