package com.palmoil.cost.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class KafkaProducerConfig {
    @Bean
    public NewTopic palmoilTopic() {
        return new NewTopic("palmoil-cost-events", 1, (short) 1);
    }
}
