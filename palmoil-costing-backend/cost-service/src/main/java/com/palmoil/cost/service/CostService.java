package com.palmoil.cost.service;

import com.palmoil.cost.model.CostEntry;
import com.palmoil.cost.repo.CostEntryRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import redis.clients.jedis.Jedis;

import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class CostService {

    @Autowired
    private CostEntryRepository costEntryRepository;

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    private final String redisHost = System.getenv().getOrDefault("REDIS_HOST", "redis");
    private final int redisPort = Integer.parseInt(System.getenv().getOrDefault("REDIS_PORT", "6379"));

    public Map<String, Object> logCost(String batchId, String category, Double amount, String description, String farmName, LocalDate costDate) {
        if (amount == null || amount <= 0) {
            throw new RuntimeException("Amount must be greater than zero");
        }
        if (category == null || category.isBlank()) {
            throw new RuntimeException("Category is required");
        }

        CostEntry entry = new CostEntry();
        entry.setBatchId(batchId);
        entry.setCategory(category.toUpperCase());
        entry.setAmount(amount);
        entry.setDescription(description);
        entry.setFarmName(farmName);
        entry.setCostDate(costDate);
        costEntryRepository.save(entry);

        publishEvent(batchId, category.toUpperCase(), amount, description);
        evictCache(batchId);

        return Map.of("message", "Cost logged", "entryId", entry.getId());
    }

    public List<CostEntry> getCosts(String batchId) {
        return costEntryRepository.findByBatchIdOrderByCreatedAtDesc(batchId);
    }

    public Map<String, Object> getBatchTotal(String batchId) {
        try (Jedis jedis = new Jedis(redisHost, redisPort)) {
            String cached = jedis.get("cost-total:" + batchId);
            if (cached != null) {
                return Map.of("batchId", batchId, "total", Double.parseDouble(cached), "source", "cache");
            }
        } catch (Exception ignored) {}

        Double total = costEntryRepository.sumByBatchId(batchId);
        double result = total == null ? 0.0 : total;
        cacheTotal(batchId, result);
        return Map.of("batchId", batchId, "total", result, "source", "db");
    }

    public List<Map<String, Object>> getCategoryBreakdown() {
        return costEntryRepository.sumByCategory();
    }

    public List<Map<String, Object>> getMonthlyReport(int year) {
        return costEntryRepository.monthlySummary(year);
    }

    public List<Map<String, Object>> getYearlyReport() {
        return costEntryRepository.yearlySummary();
    }

    private void publishEvent(String batchId, String category, Double amount, String description) {
        Map<String, Object> event = new HashMap<>();
        event.put("batchId", batchId);
        event.put("eventType", "COST_LOGGED");
        event.put("category", category);
        event.put("amount", amount);
        event.put("description", description);
        event.put("timestamp", Instant.now().toString());
        kafkaTemplate.send("palmoil-cost-events", batchId, event);
    }

    private void cacheTotal(String batchId, Double total) {
        try (Jedis jedis = new Jedis(redisHost, redisPort)) {
            jedis.setex("cost-total:" + batchId, 300, String.valueOf(total));
        } catch (Exception ignored) {}
    }

    private void evictCache(String batchId) {
        try (Jedis jedis = new Jedis(redisHost, redisPort)) {
            jedis.del("cost-total:" + batchId);
        } catch (Exception ignored) {}
    }
}
