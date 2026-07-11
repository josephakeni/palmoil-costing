package com.palmoil.cost.repo;

import com.palmoil.cost.model.CostEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Map;

public interface CostEntryRepository extends JpaRepository<CostEntry, Long> {
    List<CostEntry> findByBatchIdOrderByCreatedAtDesc(String batchId);

    @Query("SELECT SUM(e.amount) FROM CostEntry e WHERE e.batchId = :batchId")
    Double sumByBatchId(String batchId);

    @Query("SELECT e.category AS category, SUM(e.amount) AS total FROM CostEntry e GROUP BY e.category ORDER BY total DESC")
    List<Map<String, Object>> sumByCategory();
}
