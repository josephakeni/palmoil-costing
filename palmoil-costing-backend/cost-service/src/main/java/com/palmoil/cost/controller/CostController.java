package com.palmoil.cost.controller;

import com.palmoil.cost.dto.CostEntryRequest;
import com.palmoil.cost.service.CostService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/")
public class CostController {

    @Autowired
    private CostService costService;

    @GetMapping("/health")
    public Object health() {
        return java.util.Map.of("status", "ok");
    }

    @PostMapping("/costs")
    public Object logCost(@RequestBody CostEntryRequest request) {
        return costService.logCost(
                request.getBatchId(),
                request.getCategory(),
                request.getAmount(),
                request.getDescription(),
                request.getFarmName(),
                request.getCostDate()
        );
    }

    @GetMapping("/costs/{batchId}")
    public Object getCosts(@PathVariable String batchId) {
        return costService.getCosts(batchId);
    }

    @GetMapping("/costs/{batchId}/total")
    public Object getBatchTotal(@PathVariable String batchId) {
        return costService.getBatchTotal(batchId);
    }

    @GetMapping("/costs/breakdown/categories")
    public Object getCategoryBreakdown() {
        return costService.getCategoryBreakdown();
    }
}
