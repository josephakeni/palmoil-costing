package com.palmoil.cost.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "cost_entries")
public class CostEntry {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "batch_id")
    private String batchId;

    @Column(name = "category")
    private String category;

    @Column(name = "amount")
    private Double amount;

    @Column(name = "description")
    private String description;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    public Long getId() { return id; }
    public String getBatchId() { return batchId; }
    public String getCategory() { return category; }
    public Double getAmount() { return amount; }
    public String getDescription() { return description; }
    public LocalDateTime getCreatedAt() { return createdAt; }

    public void setBatchId(String batchId) { this.batchId = batchId; }
    public void setCategory(String category) { this.category = category; }
    public void setAmount(Double amount) { this.amount = amount; }
    public void setDescription(String description) { this.description = description; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
