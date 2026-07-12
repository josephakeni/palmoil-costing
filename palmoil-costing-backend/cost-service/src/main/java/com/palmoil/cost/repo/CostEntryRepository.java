package com.palmoil.cost.repo;

import com.palmoil.cost.model.CostEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Map;

public interface CostEntryRepository extends JpaRepository<CostEntry, Long> {
    List<CostEntry> findByBatchIdOrderByCreatedAtDesc(String batchId);

    @Query("SELECT SUM(e.amount) FROM CostEntry e WHERE e.batchId = :batchId")
    Double sumByBatchId(String batchId);

    @Query("SELECT e.category AS category, SUM(e.amount) AS total FROM CostEntry e GROUP BY e.category ORDER BY total DESC")
    List<Map<String, Object>> sumByCategory();

    @Query(value = """
        SELECT EXTRACT(MONTH FROM COALESCE(cost_date, created_at::date)) AS month,
               category,
               SUM(amount) AS total
        FROM cost_entries
        WHERE EXTRACT(YEAR FROM COALESCE(cost_date, created_at::date)) = :year
        GROUP BY EXTRACT(MONTH FROM COALESCE(cost_date, created_at::date)), category
        ORDER BY month, total DESC
        """, nativeQuery = true)
    List<Map<String, Object>> monthlySummary(@Param("year") int year);

    @Query(value = """
        SELECT EXTRACT(YEAR FROM COALESCE(cost_date, created_at::date)) AS year,
               category,
               SUM(amount) AS total
        FROM cost_entries
        GROUP BY EXTRACT(YEAR FROM COALESCE(cost_date, created_at::date)), category
        ORDER BY year DESC, total DESC
        """, nativeQuery = true)
    List<Map<String, Object>> yearlySummary();
}
