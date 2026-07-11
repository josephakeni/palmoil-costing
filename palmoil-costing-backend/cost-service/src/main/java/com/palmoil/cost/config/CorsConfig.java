package com.palmoil.cost.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;
import java.util.stream.Stream;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Value("${frontend.origin:http://localhost:3000}")
    private String frontendOrigin;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String[] origins = Stream.concat(
                Arrays.stream(frontendOrigin.split(",")).map(String::trim),
                Stream.of("http://127.0.0.1:3000")
        ).toArray(String[]::new);

        registry.addMapping("/**")
                .allowedOrigins(origins)
                .allowedMethods("*")
                .allowedHeaders("*");
    }
}
