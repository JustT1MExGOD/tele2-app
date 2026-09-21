# R8 rules of the native Android client.

# kotlinx.serialization: the generated serializers are found by name at run time
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontnote kotlinx.serialization.AnnotationsKt
-keep,includedescriptorclasses class ru.t2sales.**$$serializer { *; }
-keepclassmembers class ru.t2sales.** { *** Companion; }
-keepclasseswithmembers class ru.t2sales.** { kotlinx.serialization.KSerializer serializer(...); }

# Ktor and OkHttp: engines are looked up as services; some optional classes are absent on Android
-dontwarn io.ktor.**
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
-dontwarn reactor.blockhound.**

# AndroidSVG parses documents reflectively
-keep class com.caverock.androidsvg.** { *; }
