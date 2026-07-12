package com.palmoil.cost.dto;

import java.time.LocalDate;

public class CostEntryRequest {
    private String batchId;
    private String category;
    private Double amount;
    private String description;
    private String farmName;
    private LocalDate costDate;

    public String getBatchId() { return batchId; }
    public String getCategory() { return category; }
    public Double getAmount() { return amount; }
    public String getDescription() { return description; }
    public String getFarmName() { return farmName; }
    public LocalDate getCostDate() { return costDate; }

    public void setBatchId(String batchId) { this.batchId = batchId; }
    public void setCategory(String category) { this.category = category; }
    public void setAmount(Double amount) { this.amount = amount; }
    public void setDescription(String description) { this.description = description; }
    public void setFarmName(String farmName) { this.farmName = farmName; }
    public void setCostDate(LocalDate costDate) { this.costDate = costDate; }
}
